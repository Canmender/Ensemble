/**
 * 中继服务器安全加固集成测试（node:test + socket.io-client）
 *
 * 覆盖：
 * - RELAY_AUTH_KEY 启用时：HTTP /devices 鉴权、Socket.IO 握手鉴权
 * - /health 保持公开
 * - 未配置 key 时向后兼容（无 token 可连接）
 * - 同一 deviceId 重复注册顶替旧连接
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createRelayServer } = require("../dist/index.js");
const { io } = require("socket.io-client");

const AUTH_KEY = "test-relay-secret";
let server;
let port;

// ── 启动（带鉴权）───────────────────────────────────────────────────────────

before(async () => {
  server = createRelayServer({ authKey: AUTH_KEY, port: 0 });
  await server.start();
  port = server.httpServer.address().port;
});

after(async () => {
  await server.stop();
});

// ── HTTP 鉴权 ───────────────────────────────────────────────────────────────

test("GET /health is public", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
});

test("GET /devices without token → 401", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/devices`);
  assert.equal(res.status, 401);
});

test("GET /devices with wrong token → 401", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/devices`, {
    headers: { Authorization: "Bearer wrong-key" },
  });
  assert.equal(res.status, 401);
});

test("GET /devices with correct token → 200", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/devices`, {
    headers: { Authorization: `Bearer ${AUTH_KEY}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.devices));
});

// ── Socket.IO 握手鉴权 ──────────────────────────────────────────────────────

function connect(token, deviceId) {
  return new Promise((resolve) => {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      auth: token ? { token } : undefined,
    });
    socket.on("connect", () => resolve({ ok: true, socket }));
    socket.on("connect_error", (err) =>
      resolve({ ok: false, error: err.message, socket }),
    );
  });
}

function register(socket, deviceId) {
  return new Promise((resolve) => {
    socket.once("device:registered", (data) => resolve(data));
    socket.emit("device:register", {
      deviceId,
      deviceName: `设备-${deviceId}`,
      deviceType: "mobile",
    });
  });
}

test("Socket.IO without token is rejected", async () => {
  const r = await connect(undefined, "dev-no-token");
  assert.equal(r.ok, false);
  assert.equal(r.error, "unauthorized");
  r.socket.disconnect();
});

test("Socket.IO with wrong token is rejected", async () => {
  const r = await connect("wrong-key", "dev-wrong");
  assert.equal(r.ok, false);
  assert.equal(r.error, "unauthorized");
  r.socket.disconnect();
});

test("Socket.IO with correct token connects, registers, and appears in /devices", async () => {
  const r = await connect(AUTH_KEY, "dev-good");
  assert.equal(r.ok, true);
  const reg = await register(r.socket, "dev-good");
  assert.equal(reg.success, true);

  // 连接保持期间，设备应出现在已认证的 /devices 中
  const res = await fetch(`http://127.0.0.1:${port}/devices`, {
    headers: { Authorization: `Bearer ${AUTH_KEY}` },
  });
  const body = await res.json();
  assert.ok(body.devices.some((d) => d.id === "dev-good"));

  r.socket.disconnect();
});

test("same deviceId re-registration replaces the old connection", async () => {
  const first = await connect(AUTH_KEY, "dev-takeover");
  assert.equal(first.ok, true);
  await register(first.socket, "dev-takeover");

  // 先挂旧连接的断开监听，再注册第二个（触发顶替）
  const displaced = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("not-disconnected"), 2000);
    first.socket.on("disconnect", () => {
      clearTimeout(timer);
      resolve("disconnected");
    });
  });

  const second = await connect(AUTH_KEY, "dev-takeover");
  assert.equal(second.ok, true);
  await register(second.socket, "dev-takeover");

  assert.equal(await displaced, "disconnected");

  // 新连接仍有效，设备仍在线
  const res = await fetch(`http://127.0.0.1:${port}/devices`, {
    headers: { Authorization: `Bearer ${AUTH_KEY}` },
  });
  const body = await res.json();
  assert.ok(body.devices.some((d) => d.id === "dev-takeover"));

  second.socket.disconnect();
});

// ── 未配置 key 的兼容模式 ───────────────────────────────────────────────────

test("backward compatible: no auth key allows anonymous sockets", async () => {
  const compat = createRelayServer({ port: 0 });
  await compat.start();
  const compatPort = compat.httpServer.address().port;

  const r = await new Promise((resolve) => {
    const socket = io(`http://127.0.0.1:${compatPort}`, {
      transports: ["websocket"],
      reconnection: false,
    });
    socket.on("connect", () => resolve({ ok: true, socket }));
    socket.on("connect_error", (err) => resolve({ ok: false, error: err.message, socket }));
  });
  assert.equal(r.ok, true);
  r.socket.disconnect();

  const res = await fetch(`http://127.0.0.1:${compatPort}/devices`);
  assert.equal(res.status, 200); // 无 key 时 /devices 也公开（兼容）

  await compat.stop();
});
