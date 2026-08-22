import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for AES
const AUTH_TAG_LENGTH = 16;
const ENC_MARKER = "__encrypted__";

/** 密钥存储抽象：明文只在 main 进程内存中。 */
export interface KeyStore {
  get(providerId: string): string | undefined;
  set(providerId: string, key: string): void;
  has(providerId: string): boolean;
  delete(providerId: string): void;
}

/** ---------- crypto helpers ---------- */

function getKeyPath(file: string): string {
  return join(dirname(file), ".key");
}

/** Load or generate a 256-bit encryption key stored in a dedicated .key file. */
function loadOrGenerateKey(file: string): Buffer {
  const keyPath = getKeyPath(file);
  if (existsSync(keyPath)) {
    return readFileSync(keyPath);
  }
  const key = randomBytes(KEY_LENGTH);
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, key, { mode: 0o600 });
  // writeFileSync mode is a no-op on Windows (chmod too), but harmless
  try { chmodSync(keyPath, 0o600); } catch { /* Windows — ignore */ }
  return key;
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Returns a JSON-serialisable object containing iv + authTag + data (all hex).
 */
function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

/**
 * Decrypt an EncryptedPayload back to UTF-8.
 * Throws if the auth tag is invalid (tampered / wrong key).
 */
function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const data = Buffer.from(payload.data, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

interface EncryptedPayload {
  iv: string;
  authTag: string;
  data: string;
}

/** ---------- FileKeyStore ---------- */

/**
 * AES-256-GCM encrypted file storage (CLI / development mode fallback).
 *
 * On disk the secrets file is a JSON envelope:
 *   { "__encrypted__": true, "iv": "…", "authTag": "…", "data": "…" }
 *
 * A separate `.key` file (next to the secrets file) holds the raw 256-bit key
 * with restricted permissions (0o600 on Unix).
 *
 * **Migration:** If the file on disk is a plain `Record<string, string>` (old
 * unencrypted format), it is loaded as-is and transparently re-encrypted the
 * next time `save()` runs.
 */
export class FileKeyStore implements KeyStore {
  private cache: Record<string, string> = {};
  private key: Buffer;
  private dirty = false;

  constructor(private file: string) {
    this.key = loadOrGenerateKey(file);
    this.load();
  }

  // ------ persistence (encrypted) ------

  private load(): void {
    try {
      const raw = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);

      if (parsed && parsed[ENC_MARKER] === true) {
        // Encrypted format — decrypt
        this.cache = JSON.parse(decrypt(parsed as EncryptedPayload, this.key));
      } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Old plaintext JSON format — load as-is; will be re-encrypted on next save
        this.cache = parsed;
        this.dirty = true;
      } else {
        this.cache = {};
      }
    } catch {
      this.cache = {};
    }
  }

  private save(): void {
    const payload = encrypt(JSON.stringify(this.cache), this.key);
    const envelope = { [ENC_MARKER]: true, ...payload };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(envelope, null, 2), "utf8");
  }

  // ------ public API (unchanged) ------

  get(id: string): string | undefined {
    return this.cache[id];
  }

  set(id: string, key: string): void {
    this.cache[id] = key;
    this.save();
  }

  has(id: string): boolean {
    return id in this.cache;
  }

  delete(id: string): void {
    delete this.cache[id];
    this.save();
  }
}
