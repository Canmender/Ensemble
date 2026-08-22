import { safeStorage } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { KeyStore } from "@ensemble/server";

/** 基于 Electron safeStorage（Windows DPAPI）加密落盘的密钥存储 */
export function createElectronKeyStore(secretsFile: string): KeyStore {
  const load = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(secretsFile, "utf8"));
    } catch {
      return {};
    }
  };
  const save = (obj: Record<string, string>): void => {
    mkdirSync(dirname(secretsFile), { recursive: true });
    writeFileSync(secretsFile, JSON.stringify(obj, null, 2), "utf8");
  };

  return {
    get: (id) => {
      const enc = load()[id];
      if (!enc) return undefined;
      try {
        return safeStorage.decryptString(Buffer.from(enc, "base64"));
      } catch {
        return undefined;
      }
    },
    set: (id, key) => {
      const obj = load();
      obj[id] = safeStorage.encryptString(key).toString("base64");
      save(obj);
    },
    has: (id) => id in load(),
    delete: (id) => {
      const obj = load();
      delete obj[id];
      save(obj);
    },
  };
}
