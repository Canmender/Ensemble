/**
 * libsignal StorageType 实现 —— 密钥材料存 Expo SecureStore（Android Keystore 硬件加密，iOS Keychain）。
 *
 * 存储约定：
 *   e2e.identity   → { pubKey: base64, privKey: base64 }
 *   e2e.regId      → number
 *   e2e.prekey.<n> → { pubKey: base64, privKey: base64 }
 *   e2e.spkey.<n>  → { pubKey: base64, privKey: base64 }
 *   e2e.session.<addr> → SessionRecord.serialize() JSON 字符串（内存中 ArrayBuffer 已序列化为字符串）
 *   e2e.trust.<addr>   → 公钥 base64（已信任的对端身份公钥）
 *
 * 采用"内存缓存 + SecureStore 持久化"：首次访问时一次性加载，写穿缓存并异步落盘。
 */
import * as SecureStore from "expo-secure-store";
import { Buffer } from "buffer";
import {
  type StorageType,
  type KeyPairType,
  Direction,
} from "@privacyresearch/libsignal-protocol-typescript";

  // Buffer polyfill 已在 index.ts 注入；import { Buffer } from "buffer" 提供类型
function b64ToAb(b64: string): ArrayBuffer {
  return Buffer.from(b64, "base64").buffer as ArrayBuffer;
}
function abToB64(ab: ArrayBuffer): string {
  return Buffer.from(ab).toString("base64");
}

const K = {
  identity: "e2e.identity",
  regId: "e2e.regId",
  prekey: (id: number | string) => `e2e.prekey.${id}`,
  spkey: (id: number | string) => `e2e.spkey.${id}`,
  session: (addr: string) => `e2e.session.${encodeURIComponent(addr)}`,
  trust: (addr: string) => `e2e.trust.${encodeURIComponent(addr)}`,
};

/** base64 ↔ KeyPairType */
function kpToStore(kp: KeyPairType<ArrayBuffer>): string {
  return JSON.stringify({ pub: abToB64(kp.pubKey), priv: abToB64(kp.privKey) });
}
function kpFromStore(raw: string): KeyPairType<ArrayBuffer> {
  const d = JSON.parse(raw) as { pub: string; priv: string };
  return { pubKey: b64ToAb(d.pub), privKey: b64ToAb(d.priv) };
}

async function get(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
async function set(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // SecureStore 写失败静默（极端内存压力等）
  }
}
async function del(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}

export class E2EStore implements StorageType {
  private loaded = false;
  private identityKeyPair?: KeyPairType<ArrayBuffer>;
  private regId?: number;
  private preKeys = new Map<number, KeyPairType<ArrayBuffer>>();
  private signedPreKeys = new Map<number, KeyPairType<ArrayBuffer>>();
  /** 会话记录缓存：addr → SessionRecord.serialize() 字符串（libsignal 存储层只收序列化形式） */
  private sessions = new Map<string, string>();
  private trustStore = new Map<string, ArrayBuffer>(); // addr → peer identity public key

  /** 首次访问时一次性从 SecureStore 加载全部缓存 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    // 身份
    const ikRaw = await get(K.identity);
    if (ikRaw) this.identityKeyPair = kpFromStore(ikRaw);
    const regRaw = await get(K.regId);
    if (regRaw) this.regId = Number(regRaw);
    // 预密钥（0..499，很少遍历）
    await this.loadKeyRange("prekey", K.prekey, this.preKeys);
    await this.loadKeyRange("spkey", K.spkey, this.signedPreKeys);
  }

  private async loadKeyRange(
    prefix: string,
    keyFn: (id: number) => string,
    store: Map<number, KeyPairType<ArrayBuffer>>,
  ): Promise<void> {
    // 按约定密钥 id 0~499；实际只需遍历已存在的
    // SecureStore 无法枚举 key，改用记录 id 的清单键
    const idsRaw = await get(`e2e.${prefix}_ids`);
    if (!idsRaw) return;
    const ids: number[] = JSON.parse(idsRaw);
    for (const id of ids) {
      const raw = await get(keyFn(id));
      if (raw) store.set(id, kpFromStore(raw));
    }
  }

  private async saveKeyList(prefix: string, ids: number[]): Promise<void> {
    await set(`e2e.${prefix}_ids`, JSON.stringify(ids));
  }

  // ─── StorageType 实现 ────────────────────────────────────────────

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    await this.ensureLoaded();
    return this.identityKeyPair;
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    await this.ensureLoaded();
    return this.regId;
  }

  /** TOFU：首次见的对端身份无条件信任并记录；后续对比一致才信任 */
  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer, _direction: Direction): Promise<boolean> {
    await this.ensureLoaded();
    const addr = identifier;
    const known = this.trustStore.get(addr);
    if (!known) return true; // 首次，信任
    return Buffer.from(known).equals(Buffer.from(identityKey));
  }

  async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer, _nonblockingApproval?: boolean): Promise<boolean> {
    await this.ensureLoaded();
    const prev = this.trustStore.get(encodedAddress);
    const changed = prev ? !Buffer.from(prev).equals(Buffer.from(publicKey)) : false;
    this.trustStore.set(encodedAddress, publicKey);
    void set(K.trust(encodedAddress), abToB64(publicKey));
    return changed;
  }

  async loadPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    await this.ensureLoaded();
    return this.preKeys.get(Number(keyId));
  }

  async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    await this.ensureLoaded();
    const n = Number(keyId);
    this.preKeys.set(n, keyPair as KeyPairType<ArrayBuffer>);
    void set(K.prekey(n), kpToStore(keyPair as KeyPairType<ArrayBuffer>));
    const ids = [...this.preKeys.keys()].filter((k) => k !== -1);
    void this.saveKeyList("prekey", ids);
  }

  async removePreKey(keyId: number | string): Promise<void> {
    await this.ensureLoaded();
    const n = Number(keyId);
    this.preKeys.delete(n);
    void del(K.prekey(n));
    void this.saveKeyList("prekey", [...this.preKeys.keys()]);
  }

  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    await this.ensureLoaded();
    return this.signedPreKeys.get(Number(keyId));
  }

  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    await this.ensureLoaded();
    const n = Number(keyId);
    this.signedPreKeys.set(n, keyPair as KeyPairType<ArrayBuffer>);
    void set(K.spkey(n), kpToStore(keyPair as KeyPairType<ArrayBuffer>));
    void this.saveKeyList("spkey", [...this.signedPreKeys.keys()]);
  }

  async removeSignedPreKey(keyId: number | string): Promise<void> {
    await this.ensureLoaded();
    const n = Number(keyId);
    this.signedPreKeys.delete(n);
    void del(K.spkey(n));
    void this.saveKeyList("spkey", [...this.signedPreKeys.keys()]);
  }

  async loadSession(encodedAddress: string): Promise<string | undefined> {
    await this.ensureLoaded();
    const cached = this.sessions.get(encodedAddress);
    if (cached) return cached;
    const raw = await get(K.session(encodedAddress));
    if (raw) this.sessions.set(encodedAddress, raw);
    return raw ?? undefined;
  }

  /** record 已是 SessionRecord.serialize() 的结果（libsignal 类型别名 SessionRecordType = string） */
  async storeSession(encodedAddress: string, record: string): Promise<void> {
    await this.ensureLoaded();
    this.sessions.set(encodedAddress, record);
    void set(K.session(encodedAddress), record);
  }

  // ─── 供 E2EService 调用的辅助方法 ───────────────────────────────

  /** 注册时写入身份密钥对 + 注册 ID（首次本地生成后调用） */
  async setIdentity(ikp: KeyPairType<ArrayBuffer>, regId: number): Promise<void> {
    this.identityKeyPair = ikp;
    this.regId = regId;
    this.loaded = true;
    void set(K.identity, kpToStore(ikp));
    void set(K.regId, String(regId));
  }

  /** 当前本地预密钥数量（含待上传和已上传未消耗的） */
  get localPreKeyCount(): number {
    return this.preKeys.size;
  }
}
