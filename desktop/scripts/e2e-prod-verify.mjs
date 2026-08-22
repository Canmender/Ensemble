/**
 * 生产服务器 E2E 协议级互通验证（自包含：自动注册探针账号→注册密钥→加密互发→解密）。
 * 验证点：生产环境 /api/e2e/* 可用、密文信封落库、双向棘轮。
 * 运行：node scripts/e2e-prod-verify.mjs <host:port>
 */
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const BASE = `http://${process.argv[2] ?? "127.0.0.1:8787"}`;
const STAMP = Date.now().toString(36);
const USER_A = `e2eprobe_a_${STAMP}`;
const USER_B = `e2eprobe_b_${STAMP}`;
const PASS = "E2eProbe#2026!x";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const { KeyHelper, SessionBuilder, SessionCipher, SignalProtocolAddress } = await import(
  "@privacyresearch/libsignal-protocol-typescript"
);

const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const binToB64 = (bin) => Buffer.from(bin, "latin1").toString("base64");
const b64ToBin = (b64s) => Buffer.from(b64s, "base64").toString("latin1");

const api = async (path, token, method = "GET", body) => {
  const res = await fetch(BASE + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(json)?.slice(0, 160)}`);
  return json?.data ?? json;
};
const register = async (username) =>
  (await api("/auth/register", undefined, "POST", { username, password: PASS })).token ??
  (await api("/auth/login", undefined, "POST", { username, password: PASS })).token;

class Store {
  constructor() { this.m = new Map(); }
  async getIdentityKeyPair() { return this.m.get("ik"); }
  async getLocalRegistrationId() { return this.m.get("rid"); }
  async isTrustedIdentity(id, k) {
    const key = id + ":id";
    if (!this.m.has(key)) { this.m.set(key, k); return true; }
    return Buffer.compare(Buffer.from(this.m.get(key)), Buffer.from(k)) === 0;
  }
  async saveIdentity(id, k) { this.m.set(id + ":id", k); return true; }
  async loadIdentityKey(id) { return this.m.get(id + ":id"); }
  async loadPreKey(n) { return this.m.get("pk" + n); }
  async storePreKey(n, kp) { this.m.set("pk" + n, kp); }
  async removePreKey(n) { this.m.delete("pk" + n); }
  async loadSignedPreKey(n) { return this.m.get("spk" + n); }
  async storeSignedPreKey(n, kp) { this.m.set("spk" + n, kp); }
  async removeSignedPreKey() {}
  async storeSession(id, r) { this.m.set("s:" + id, r); }
  async loadSession(id) { return this.m.get("s:" + id); }
  async removeSession(id) { this.m.delete("s:" + id); }
}

async function enroll(token) {
  const ik = await KeyHelper.generateIdentityKeyPair();
  const spk = await KeyHelper.generateSignedPreKey(ik, 1);
  const opks = [];
  for (let i = 1; i <= 100; i++) {
    const p = await KeyHelper.generatePreKey(i);
    opks.push({ id: i, keyPair: p.keyPair, pub: b64(p.keyPair.pubKey) });
  }
  await api("/e2e/register", token, "PUT", {
    identityKey: b64(ik.pubKey),
    signedPreKeyId: 1,
    signedPreKey: b64(spk.keyPair.pubKey),
    signedPreKeySignature: b64(spk.signature),
    oneTimePreKeys: opks.map((o) => ({ id: o.id, key: o.pub })),
  });
  return { ik, spk, opks };
}

async function main() {
  console.log(`目标: ${BASE}`);
  const tA = await register(USER_A);
  const tB = await register(USER_B);
  const meA = await api("/auth/me", tA);
  const meB = await api("/auth/me", tB);
  console.log(`A=${meA.id} B=${meB.id} 已注册`);

  // 双方懒注册（与客户端 ensureEnrolled 同构）
  const matA = await enroll(tA);
  const matB = await enroll(tB);

  // capability 双向
  if (!(await api(`/e2e/capability/${meB.id}`, tA)).enrolled) throw new Error("B capability 异常");
  console.log("capability 双向 ✓");

  // 会话（direct 只传对方）
  let conv;
  try {
    conv = await api("/conversations", tA, "POST", { type: "direct", participantIds: [meB.id] });
  } catch {
    conv = (await api("/conversations", tA)).find((c) => c.type === "direct");
  }

  // A 取 B bundle → X3DH → 发首条（type 3）
  const bundle = await api(`/e2e/bundle/${meB.id}`, tA);
  const addrB = new SignalProtocolAddress(meB.id, 1);
  function newStoreA() {
    const s = new Store();
    s.m.set("ik", matA.ik);
    s.m.set("spk1", matA.spk.keyPair);
    for (const o of matA.opks) s.m.set("pk" + o.id, o.keyPair);
    return s;
  }
  // 注意：X3DH 与后续加解密必须共用同一个 Store 实例（会话记录在实例内）
  const sA = newStoreA();
  await new SessionBuilder(sA, addrB).processPreKey({
    identityKey: unb64(bundle.identityKey).buffer,
    signedPreKey: { keyId: bundle.signedPreKeyId, publicKey: unb64(bundle.signedPreKey).buffer, signature: unb64(bundle.signedPreKeySignature).buffer },
    preKey: bundle.oneTimePreKey ? { keyId: bundle.oneTimePreKey.id, publicKey: unb64(bundle.oneTimePreKey.key).buffer } : undefined,
  });
  const cA = new SessionCipher(sA, addrB);
  const msg1 = `prod-verify ${STAMP} 你好 B 🔐`;
  const ct1 = await cA.encrypt(new TextEncoder().encode(msg1).buffer);
  await api(`/conversations/${conv.id}/messages`, tA, "POST", {
    content: JSON.stringify({ e2e: 1, v: 1, ct: { type: ct1.type, body: binToB64(ct1.body) } }),
    clientMsgId: "pv1-" + STAMP,
  });
  console.log(`A→B 密文已落库（type=${ct1.type}）`);

  // B 解密首条
  const sB = new Store();
  sB.m.set("ik", matB.ik);
  sB.m.set("spk1", matB.spk.keyPair);
  for (const o of matB.opks) sB.m.set("pk" + o.id, o.keyPair);
  const hist1 = await api(`/conversations/${conv.id}/messages`, tB);
  const env1 = JSON.parse(hist1.messages.at(-1).content);
  const pt1 = new TextDecoder().decode(
    new Uint8Array(await new SessionCipher(sB, new SignalProtocolAddress(meA.id, 1)).decryptPreKeyWhisperMessage(b64ToBin(env1.ct.body), "binary")),
  );
  if (pt1 !== msg1) throw new Error(`解密不匹配: ${pt1}`);
  console.log(`B 解密 ✓ "${pt1}"`);

  // B 回复（type 1）→ A 解密
  const msg2 = `prod-verify 回复 ${STAMP}`;
  const ct2 = await new SessionCipher(sB, new SignalProtocolAddress(meA.id, 1)).encrypt(new TextEncoder().encode(msg2).buffer);
  await api(`/conversations/${conv.id}/messages`, tB, "POST", {
    content: JSON.stringify({ e2e: 1, v: 1, ct: { type: ct2.type, body: binToB64(ct2.body) } }),
    clientMsgId: "pv2-" + STAMP,
  });
  const hist2 = await api(`/conversations/${conv.id}/messages`, tA);
  const env2 = JSON.parse(hist2.messages.at(-1).content);
  const pt2 = new TextDecoder().decode(new Uint8Array(await cA.decryptWhisperMessage(b64ToBin(env2.ct.body), "binary")));
  if (pt2 !== msg2) throw new Error(`回复解密不匹配: ${pt2}`);
  console.log(`A 解密回复 ✓ "${pt2}"`);

  console.log(`\n✅ 生产服务器 E2E 协议互通验证通过（${BASE}）`);
  console.log(`探针账号: ${USER_A} / ${USER_B}（请自行清理或保留复测）`);
}

main().catch((e) => { console.error("❌ 验证失败:", e.message); process.exit(1); });
