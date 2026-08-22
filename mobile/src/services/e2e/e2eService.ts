/**
 * 端到端加密服务（X3DH + Double Ratchet，libsignal 协议库）
 *
 * 依赖 index.ts 的 Buffer/process/crypto polyfill。
 * 私钥/会话存 SecureStore（Android Keystore 硬件加密 / iOS Keychain），永不离机。
 *
 * 对外仅三个方法：
 *   ensureEnrolled()         — 登录后懒调用，无本地身份时自动生成+注册。
 *   encryptFor(userId, text) — 加密文字消息；对方未注册返回 null（调用方走明文）。
 *   decryptFrom(userId, envelopeContent) — 解密一条信封；失败返回占位文案，不抛错。
 *
 * 消息信封（复用现有 chat 通道，服务器无感）：
 *   {"e2e":1,"v":1,"ct":{"type":<1|3>,"body":"<base64 libsignal 密文>"}}
 */
import { KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  setWebCrypto,
  type DeviceType,
} from "@privacyresearch/libsignal-protocol-typescript";
// @peculiar/webcrypto：纯 JS WebCrypto 实现（AES-CBC/HMAC/HKDF subtle 原语），
// RN Hermes 无内建 WebCrypto，libsignal 的加解密全部走它
import { Crypto as PeculiarCrypto } from "@peculiar/webcrypto";
import { Buffer } from "buffer";
import { E2EStore } from "./store";
import { api } from "../api";

// RN Hermes 无内建 WebCrypto：注入纯 JS 实现（随机数 + AES-CBC + HMAC-SHA256 subtle）
try {
  (setWebCrypto as unknown as (c: unknown) => void)(new PeculiarCrypto());
} catch {
  /* 注入失败时 libsignal 走内部路径 */
}

/** UTF-8 字符串 → 独立 ArrayBuffer。
 *  注意：Buffer.buffer 返回的是内存池（可达 8KB），必须 slice 出实际字节，
 *  否则会把整块池内存一起加密（实测导致密文膨胀 400 倍且对端无法解密）。 */
function utf8ToAb(s: string): ArrayBuffer {
  const b = Buffer.from(s, "utf-8");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** libsignal encrypt().body 是 binary string（每字符一字节），JSON 信封传输需 base64 */
function binToB64(bin: string): string {
  return Buffer.from(bin, "binary").toString("base64");
}
/** base64 → binary string（decrypt*WhisperMessage 的 string 入参即此格式） */
function b64ToBin(b64: string): string {
  return Buffer.from(b64, "base64").toString("binary");
}

const SELF_DEVICE_ID = 1; // 每端只有一个设备身份
const OPK_COUNT = 100;    // 注册/补充时生成的一次性预密钥数量
const OPK_LOW = 20;       // 余量低于此值触发补充
const CAPABILITY_TTL = 5 * 60 * 1000; // capability 缓存 ≤ 5 分钟
const E2E_ENVELOPE_MARKER = '"e2e":1';

const PLACEHOLDER = "🔒 无法解密的消息（对方可能重新安装了应用）";

// ─── 单例 ────────────────────────────────────────────────────────

const store = new E2EStore();
let enrolled = false;
const capabilityCache = new Map<string, { enrolled: boolean; ts: number }>();

// ─── 工具 ────────────────────────────────────────────────────────

function b64ToAb(b64: string): ArrayBuffer {
  return Buffer.from(b64, "base64").buffer as ArrayBuffer;
}
function abToB64(ab: ArrayBuffer): string {
  return Buffer.from(ab).toString("base64");
}

function address(userId: string): SignalProtocolAddress {
  return new SignalProtocolAddress(userId, SELF_DEVICE_ID);
}

/** 把服务端 bundle 响应映射为 libsignal DeviceType（服务端不存 registrationId，置 0） */
function bundleToDevice(b: {
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKey?: { id: number; key: string };
}): DeviceType {
  return {
    identityKey: b64ToAb(b.identityKey),
    registrationId: 0,
    signedPreKey: {
      keyId: b.signedPreKeyId,
      publicKey: b64ToAb(b.signedPreKey),
      signature: b64ToAb(b.signedPreKeySignature),
    },
    preKey: b.oneTimePreKey
      ? { keyId: b.oneTimePreKey.id, publicKey: b64ToAb(b.oneTimePreKey.key) }
      : undefined,
  } as DeviceType;
}

/** 把 capability 结果做 ≤TTL 内存缓存 */
async function isPeerEnrolled(userId: string): Promise<boolean> {
  const hit = capabilityCache.get(userId);
  if (hit && Date.now() - hit.ts < CAPABILITY_TTL) return hit.enrolled;
  try {
    const res = await api.getE2eCapability(userId);
    const val = !!res.data?.enrolled;
    capabilityCache.set(userId, { enrolled: val, ts: Date.now() });
    return val;
  } catch {
    // 网络异常时默认不加密（灰度共存），下次请求再试
    return false;
  }
}

// ─── 注册 ────────────────────────────────────────────────────────

/** 懒注册：无本地身份时生成密钥包并上报服务端；已有身份时静默返回 */
async function ensureEnrolled(): Promise<void> {
  if (enrolled) return;
  const existing = await store.getIdentityKeyPair();
  if (existing) {
    enrolled = true;
    return;
  }
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);

  // 生成 100 个一次性预密钥（id 0..99）
  const opks: Array<{ id: number; key: string }> = [];
  for (let i = 0; i < OPK_COUNT; i++) {
    const kp = await KeyHelper.generatePreKey(i);
    await store.storePreKey(kp.keyId, kp.keyPair);
    opks.push({ id: kp.keyId, key: abToB64(kp.keyPair.pubKey) });
  }

  await store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);
  await store.setIdentity(identityKeyPair, registrationId);

  await api.registerE2eIdentity({
    identityKey: abToB64(identityKeyPair.pubKey),
    signedPreKeyId: signedPreKey.keyId,
    signedPreKey: abToB64(signedPreKey.keyPair.pubKey),
    signedPreKeySignature: abToB64(signedPreKey.signature),
    oneTimePreKeys: opks,
  });

  enrolled = true;
}

/** OPK 余量检查与补充（解密 type 3 消息后调用） */
async function replenishOpksIfNeeded(): Promise<void> {
  if (store.localPreKeyCount >= OPK_LOW) return;
  try {
    const startId = Date.now() % 1_000_000; // 大偏移避免 id 冲突
    const keys: Array<{ id: number; key: string }> = [];
    for (let i = 0; i < OPK_COUNT; i++) {
      const kp = await KeyHelper.generatePreKey(startId + i);
      await store.storePreKey(kp.keyId, kp.keyPair);
      keys.push({ id: kp.keyId, key: abToB64(kp.keyPair.pubKey) });
    }
    await api.addE2eOneTimePreKeys(keys);
  } catch {
    /* 补充失败静默：OPK 耗尽后仍可无 OPK 的 X3DH（少 DH4） */
  }
}

// ─── 对外 API ───────────────────────────────────────────────────

/**
 * 加密一条文字消息。返回 E2E 信封 JSON 字符串；
 * 返回 null 表示对方未注册端到端加密——调用方应发明文。
 */
export async function encryptFor(peerUserId: string, plaintext: string): Promise<string | null> {
  await ensureEnrolled();
  const peerOk = await isPeerEnrolled(peerUserId);
  if (!peerOk) return null;

  const addr = address(peerUserId);
  const cipher = new SessionCipher(store, addr);

  // 无会话时先建会话（fetch bundle → processPreKey）
  if (!(await cipher.hasOpenSession())) {
    const bundleRes = await api.getE2eBundle(peerUserId);
    if (!bundleRes.data) return null; // 对端密钥不可用
    const builder = new SessionBuilder(store, addr);
    await builder.processPreKey(bundleToDevice(bundleRes.data));
  }

  const enc = await cipher.encrypt(utf8ToAb(plaintext));
  if (!enc.body) return null; // 理论不可达：encrypt 成功必有 body
  // enc.body 是 binary string，转 base64 后入信封（JSON 安全传输）
  return JSON.stringify({ e2e: 1, v: 1, ct: { type: enc.type, body: binToB64(enc.body) } });
}

/**
 * 解密一条来自 peerUserId 的消息内容（可能是明文也可能是 E2E 信封）。
 * - 非 E2E 信封：原样返回。
 * - 解密成功：返回明文。
 * - 解密失败：返回占位文案（不抛错）。
 */
export async function decryptFrom(peerUserId: string, content: string): Promise<string> {
  // 快速跳过普通明文
  if (!content.startsWith("{") || !content.includes(E2E_ENVELOPE_MARKER)) return content;
  try {
    const envelope = JSON.parse(content) as { e2e?: number; ct?: { type?: number; body?: string } };
    if (envelope.e2e !== 1 || !envelope.ct?.body) return content;

    await ensureEnrolled();
    const addr = address(peerUserId);
    const cipher = new SessionCipher(store, addr);
    // 信封里是 base64；decrypt*WhisperMessage 的 string 入参是 binary string
    const cipherBin = b64ToBin(envelope.ct.body);
    const plainBuf =
      envelope.ct.type === 3
        ? await cipher.decryptPreKeyWhisperMessage(cipherBin)
        : await cipher.decryptWhisperMessage(cipherBin);
    const plaintext = Buffer.from(plainBuf).toString("utf-8");

    // 接收 type 3 = 本端 OPK 被消耗，检查补充
    if (envelope.ct.type === 3) {
      void replenishOpksIfNeeded(); // fire-and-forget
    }
    return plaintext;
  } catch {
    return PLACEHOLDER;
  }
}
