/**
 * E2E 端到端加密客户端（协议见 desktop/docs/E2E-PROTOCOL.md）。
 *
 * v1 范围：1:1 用户私聊。群聊 / Agent 会话 / 附件明文（与现状一致）。
 * 两端统一 @privacyresearch/libsignal-protocol-typescript（X3DH + Double Ratchet），
 * 线格式与移动端兼容。私钥只存本机（localStorage，key 前缀 ensemble.e2e.；
 * 加固路线：IPC → Electron safeStorage/DPAPI）。服务器只见公钥（/api/e2e/* 密钥目录）。
 */
import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  type StorageType,
  type KeyPairType,
  type DeviceType,
  type MessageType,
} from "@privacyresearch/libsignal-protocol-typescript";
import { api } from "./api";

// ---------- localStorage 协议存储 ----------

const STORE_PREFIX = "ensemble.e2e.";
const dir = (name: string) => `${STORE_PREFIX}${name}`;

function jsonGet<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(dir(key));
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function jsonSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(dir(key), JSON.stringify(value));
  } catch {
    /* 存储不可用时静默（隐私模式）→ 收发自动回退明文 */
  }
}
function jsonDel(key: string): void {
  try {
    localStorage.removeItem(dir(key));
  } catch {
    /* ignore */
  }
}

/** base64 ↔ ArrayBuffer（协议线格式统一 base64） */
export function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
export function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const kpToB64 = (kp: KeyPairType): { pubKey: string; privKey: string } => ({
  pubKey: bufToB64(kp.pubKey),
  privKey: bufToB64(kp.privKey),
});
const kpFromB64 = (b: { pubKey: string; privKey: string }): KeyPairType => ({
  pubKey: b64ToBuf(b.pubKey),
  privKey: b64ToBuf(b.privKey),
});

/**
 * libsignal StorageType 适配器。identifier 统一为 `${userId}.1`
 * （设备号固定 1：v1 每设备独立身份，与协议 §2 一致）。
 */
class LsProtocolStore implements StorageType {
  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    const kp = jsonGet<{ pubKey: string; privKey: string }>("identity-key-pair");
    return kp ? kpFromB64(kp) : undefined;
  }
  async getLocalRegistrationId(): Promise<number | undefined> {
    return jsonGet<number>("registration-id");
  }
  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
    // TOFU：首次信任并记录；之后比对（不一致 = 对端重装 → 会话需重建，由上层处理）
    const b64 = bufToB64(identityKey);
    const known = jsonGet<string>(`identity-${identifier}`);
    if (!known) {
      jsonSet(`identity-${identifier}`, b64);
      return true;
    }
    return known === b64;
  }
  async saveIdentity(identifier: string, publicKey: ArrayBuffer): Promise<boolean> {
    const prev = jsonGet<string>(`identity-${identifier}`);
    const b64 = bufToB64(publicKey);
    jsonSet(`identity-${identifier}`, b64);
    // 身份变化时清旧会话（libsignal 约定返回 changed）
    if (prev && prev !== b64) {
      this.removeSession(identifier);
      return true;
    }
    return false;
  }
  async loadIdentityKey(identifier: string): Promise<ArrayBuffer | undefined> {
    const b64 = jsonGet<string>(`identity-${identifier}`);
    return b64 ? b64ToBuf(b64) : undefined;
  }
  async loadPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const kp = jsonGet<{ pubKey: string; privKey: string }>(`prekey-${keyId}`);
    return kp ? kpFromB64(kp) : undefined;
  }
  async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    jsonSet(`prekey-${keyId}`, kpToB64(keyPair));
  }
  async removePreKey(keyId: number | string): Promise<void> {
    jsonDel(`prekey-${keyId}`);
  }
  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const kp = jsonGet<{ pubKey: string; privKey: string }>(`signed-prekey-${keyId}`);
    return kp ? kpFromB64(kp) : undefined;
  }
  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    jsonSet(`signed-prekey-${keyId}`, kpToB64(keyPair));
  }
  async removeSignedPreKey(keyId: number | string): Promise<void> {
    jsonDel(`signed-prekey-${keyId}`);
  }
  async storeSession(identifier: string, record: string): Promise<void> {
    jsonSet(`session-${identifier}`, record);
  }
  async loadSession(identifier: string): Promise<string | undefined> {
    return jsonGet<string>(`session-${identifier}`);
  }
  async removeSession(identifier: string): Promise<void> {
    jsonDel(`session-${identifier}`);
  }
}

const protocolStore = new LsProtocolStore();

/** 设备地址（v1 deviceId 固定 1） */
const addrOf = (userId: string): SignalProtocolAddress =>
  new SignalProtocolAddress(userId, 1);

// ---------- 注册 ----------

const OPK_TARGET = 100;
const OPK_REFILL_BELOW = 20;
const CAPABILITY_TTL_MS = 5 * 60 * 1000;

/** 本机是否已生成并上传过密钥 */
export function isEnrolledLocally(): boolean {
  return !!jsonGet("identity-key-pair");
}

/** 登录后懒注册（幂等）：生成 IK + SPK + OPK×100，上传公钥材料 */
export async function ensureEnrolled(): Promise<boolean> {
  if (isEnrolledLocally()) return false;

  const registrationId = KeyHelper.generateRegistrationId();
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const signedPreKeyId = 1;
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);

  const oneTimePreKeys: Array<{ id: number; key: string }> = [];
  for (let i = 1; i <= OPK_TARGET; i++) {
    const preKey = await KeyHelper.generatePreKey(i);
    await protocolStore.storePreKey(i, preKey.keyPair);
    oneTimePreKeys.push({ id: i, key: bufToB64(preKey.keyPair.pubKey) });
  }
  await protocolStore.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);

  await api.put("/e2e/register", {
    identityKey: bufToB64(identityKeyPair.pubKey),
    signedPreKeyId,
    signedPreKey: bufToB64(signedPreKey.keyPair.pubKey),
    signedPreKeySignature: bufToB64(signedPreKey.signature),
    oneTimePreKeys,
  });

  jsonSet("identity-key-pair", kpToB64(identityKeyPair));
  jsonSet("registration-id", registrationId);
  jsonSet("spk-id", signedPreKeyId);
  return true;
}

/** 对端 capability 缓存（≤5 分钟，协议 §4） */
const capCache = new Map<string, { enrolled: boolean; at: number }>();

export async function peerEnrolled(peerUserId: string): Promise<boolean> {
  const hit = capCache.get(peerUserId);
  if (hit && Date.now() - hit.at < CAPABILITY_TTL_MS) return hit.enrolled;
  try {
    const d = await api.get<{ enrolled: boolean }>(`/e2e/capability/${peerUserId}`);
    capCache.set(peerUserId, { enrolled: !!d?.enrolled, at: Date.now() });
    return !!d?.enrolled;
  } catch {
    return false;
  }
}

/** 双方都已注册才加密（灰度共存判定，含本机懒注册） */
export async function canEncryptWith(peerUserId: string): Promise<boolean> {
  try {
    await ensureEnrolled();
  } catch {
    return false; // 本机注册失败（如离线）→ 明文
  }
  return peerEnrolled(peerUserId);
}

// ---------- 信封（协议 §4）：content 为 JSON 字符串，服务器无感透传 ----------

export interface E2eEnvelope {
  e2e: 1;
  v: 1;
  ct: { type: 1 | 3; body: string };
}

export function isE2eContent(content: unknown): content is string {
  if (typeof content !== "string" || !content.startsWith("{")) return false;
  try {
    const j = JSON.parse(content) as Partial<E2eEnvelope>;
    return j?.e2e === 1 && j?.v === 1 && typeof (j.ct as any)?.body === "string";
  } catch {
    return false;
  }
}
const wrapEnvelope = (ct: { type: 1 | 3; body: string }): string =>
  JSON.stringify({ e2e: 1, v: 1, ct } satisfies E2eEnvelope);

/** 解密失败占位（不抛错，协议 §4） */
export const DECRYPT_FAILED_PLACEHOLDER = "🔒 无法解密的消息（对方可能重新安装了应用）";

// ---------- 收发 ----------

/** 加密发给对端；首次通信自动 X3DH 建会话（取对端 bundle） */
export async function encryptMessage(peerUserId: string, plaintext: string): Promise<string> {
  const address = addrOf(peerUserId);
  let hasSession = false;
  try {
    hasSession = !!(await new SessionCipher(protocolStore, address).hasOpenSession());
  } catch {
    hasSession = false;
  }
  if (!hasSession) await buildSessionAsInitiator(peerUserId);

  const cipher = new SessionCipher(protocolStore, address);
  const ct: MessageType = await cipher.encrypt(
    new TextEncoder().encode(plaintext).buffer as ArrayBuffer,
  );
  if (!ct.body) throw new Error("加密输出为空");
  return wrapEnvelope({ type: ct.type as 1 | 3, body: ct.body });
}

/** 解密来自对端的信封；失败返回占位文本（绝不抛错） */
export async function decryptMessage(peerUserId: string, envelopeJson: string): Promise<string> {
  try {
    const env = JSON.parse(envelopeJson) as E2eEnvelope;
    const cipher = new SessionCipher(protocolStore, addrOf(peerUserId));
    const pt =
      env.ct.type === 3
        ? await cipher.decryptPreKeyWhisperMessage(env.ct.body, "binary")
        : await cipher.decryptWhisperMessage(env.ct.body, "binary");
    return new TextDecoder().decode(new Uint8Array(pt));
  } catch {
    return DECRYPT_FAILED_PLACEHOLDER;
  }
}

// ---------- 会话建立（X3DH，作为发起方）----------

async function buildSessionAsInitiator(peerUserId: string): Promise<void> {
  await ensureEnrolled();
  const bundle = await api.get<{
    identityKey: string;
    signedPreKeyId: number;
    signedPreKey: string;
    signedPreKeySignature: string;
    oneTimePreKey?: { id: number; key: string };
  }>(`/e2e/bundle/${peerUserId}`);

  const device: DeviceType = {
    identityKey: b64ToBuf(bundle.identityKey),
    signedPreKey: {
      keyId: bundle.signedPreKeyId,
      publicKey: b64ToBuf(bundle.signedPreKey),
      signature: b64ToBuf(bundle.signedPreKeySignature),
    },
    ...(bundle.oneTimePreKey
      ? {
          preKey: {
            keyId: bundle.oneTimePreKey.id,
            publicKey: b64ToBuf(bundle.oneTimePreKey.key),
          },
        }
      : {}),
  };

  const builder = new SessionBuilder(protocolStore, addrOf(peerUserId));
  await builder.processPreKey(device);
  void maybeRefillOpks();
}

/** OPK 余量低于阈值时补充一批（服务端取走即删） */
async function maybeRefillOpks(): Promise<void> {
  try {
    const remaining = Object.keys(localStorage).filter((k) =>
      k.startsWith(STORE_PREFIX + "prekey-"),
    ).length;
    if (remaining >= OPK_REFILL_BELOW) return;
    const batch: Array<{ id: number; key: string }> = [];
    for (let i = 0; i < OPK_TARGET; i++) {
      const id = 100000 + Math.floor(Math.random() * 900000000) + i;
      const preKey = await KeyHelper.generatePreKey(id);
      await protocolStore.storePreKey(id, preKey.keyPair);
      batch.push({ id, key: bufToB64(preKey.keyPair.pubKey) });
    }
    await api.post("/e2e/opks", { oneTimePreKeys: batch });
  } catch {
    /* 补充失败不影响当前收发 */
  }
}
