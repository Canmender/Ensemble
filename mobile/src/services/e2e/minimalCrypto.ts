/**
 * MinimalWebCrypto —— RN Hermes 专用的最小 WebCrypto subtle 实现。
 *
 * 背景：@peculiar/webcrypto 模块加载期调用 node:crypto.getCiphers() 做 AES 探测，
 * Metro 把 node:crypto 映射为空模块 → 加载即抛 "crypto.getCiphers is not a function"
 * → e2eService 在 App import 树上 → 整个应用白屏（v0.9.7/v0.9.8 白屏根因）。
 *
 * libsignal 实际只用四个原语，全部用 audited 纯 JS 库 @noble/* 实现零依赖：
 *   getRandomValues            → expo-crypto
 *   AES-CBC encrypt/decrypt    → @noble/ciphers webcbc
 *   HMAC-SHA256 sign/verify    → @noble/hashes hmac
 *   HKDF-SHA256 deriveBits     → @noble/hashes hkdf
 */
import { cbc } from "@noble/ciphers/aes.js";
import { hmac as nobleHmac } from "@noble/hashes/hmac.js";
import { hkdf as nobleHkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as ExpoCrypto from "expo-crypto";

type JsonWebKey = unknown;

interface SubtleKey {
  raw: Uint8Array;
  algorithm: { name: string; hash?: { name: string } };
  usages: string[];
}

function assertUsages(key: SubtleKey, needed: string[]): void {
  for (const u of needed) {
    if (!key.usages.includes(u)) throw new Error(`key usages 不含 ${u}`);
  }
}

class MinimalSubtle {
  async importKey(
    format: string,
    data: ArrayBuffer | Uint8Array | JsonWebKey,
    algorithm: { name: string; hash?: { name: string } },
    _extractable: boolean,
    keyUsages: string[],
  ): Promise<SubtleKey> {
    if (format !== "raw") throw new Error(`MinimalSubtle 仅支持 raw 格式，收到 ${format}`);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    if (algorithm.name !== "AES-CBC" && algorithm.name !== "HMAC" && algorithm.name !== "HKDF") {
      throw new Error(`MinimalSubtle 仅支持 AES-CBC/HMAC/HKDF，收到 ${algorithm.name}`);
    }
    return { raw: bytes, algorithm, usages: keyUsages };
  }

  async encrypt(
    params: { name: string; iv: ArrayBuffer | Uint8Array },
    key: SubtleKey,
    data: ArrayBuffer | Uint8Array,
  ): Promise<ArrayBuffer> {
    if (params.name !== "AES-CBC" || key.algorithm.name !== "AES-CBC") {
      throw new Error("仅支持 AES-CBC");
    }
    assertUsages(key, ["encrypt"]);
    const iv = params.iv instanceof Uint8Array ? params.iv : new Uint8Array(params.iv);
    const plain = data instanceof Uint8Array ? data : new Uint8Array(data);
    // noble cbc 输出含 PKCS#7 padding，与 WebCrypto 一致
    const ct = cbc(key.raw, iv).encrypt(plain);
    return ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer;
  }

  async decrypt(
    params: { name: string; iv: ArrayBuffer | Uint8Array },
    key: SubtleKey,
    data: ArrayBuffer | Uint8Array,
  ): Promise<ArrayBuffer> {
    if (params.name !== "AES-CBC" || key.algorithm.name !== "AES-CBC") {
      throw new Error("仅支持 AES-CBC");
    }
    assertUsages(key, ["decrypt"]);
    const iv = params.iv instanceof Uint8Array ? params.iv : new Uint8Array(params.iv);
    const ct = data instanceof Uint8Array ? data : new Uint8Array(data);
    // noble 的 cbc.decrypt 已自动校验并剥离 PKCS#7 padding（与 WebCrypto 行为一致）
    const plain = cbc(key.raw, iv).decrypt(ct);
    return plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer;
  }

  async sign(
    _params: { name: string; hash: { name: string } } | { name: string },
    key: SubtleKey,
    data: ArrayBuffer | Uint8Array,
  ): Promise<ArrayBuffer> {
    if (key.algorithm.name !== "HMAC") throw new Error("sign 仅支持 HMAC");
    const hashName = key.algorithm.hash?.name ?? "SHA-256";
    if (hashName !== "SHA-256") throw new Error(`仅支持 SHA-256，收到 ${hashName}`);
    assertUsages(key, ["sign"]);
    const msg = data instanceof Uint8Array ? data : new Uint8Array(data);
    const mac = nobleHmac(sha256, key.raw, msg);
    return mac.buffer.slice(mac.byteOffset, mac.byteOffset + mac.byteLength) as ArrayBuffer;
  }

  /** libsignal verifyMAC 用 sign 后比对实现（不使用原生 verify） */
  async verify(
    params: Parameters<MinimalSubtle["sign"]>[0],
    key: SubtleKey,
    signature: ArrayBuffer | Uint8Array,
    data: ArrayBuffer | Uint8Array,
  ): Promise<boolean> {
    const expected = await this.sign(params, key, data);
    const sig = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
    const exp = new Uint8Array(expected);
    if (sig.length !== exp.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig[i] ^ exp[i];
    return diff === 0;
  }

  async deriveBits(
    params: { name: string; hash?: { name: string }; salt?: ArrayBuffer | Uint8Array; info?: ArrayBuffer | Uint8Array },
    baseKey: SubtleKey,
    length: number,
  ): Promise<ArrayBuffer> {
    if (params.name !== "HKDF") throw new Error(`deriveBits 仅支持 HKDF，收到 ${params.name}`);
    assertUsages(baseKey, ["deriveBits"]);
    const ikm = baseKey.raw;
    const salt = params.salt instanceof Uint8Array ? params.salt : params.salt ? new Uint8Array(params.salt) : new Uint8Array(0);
    const info = params.info instanceof Uint8Array ? params.info : params.info ? new Uint8Array(params.info) : new Uint8Array(0);
    const bits = nobleHkdf(sha256, ikm, salt, info, length / 8);
    return bits.buffer.slice(bits.byteOffset, bits.byteOffset + bits.byteLength) as ArrayBuffer;
  }
}

export class MinimalCrypto {
  readonly subtle = new MinimalSubtle();

  getRandomValues<T extends Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array>(array: T): T {
    return ExpoCrypto.getRandomValues(array);
  }
}
