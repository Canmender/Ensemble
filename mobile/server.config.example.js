// 服务器配置模板（可提交示例）。复制为 server.config.js 并填入真实值；
// server.config.js 已在 .gitignore 中，不会提交到 GitHub。
module.exports = {
  cloud: { host: "YOUR_SERVER_HOST", port: 8787 },
  cleartextDomains: ["YOUR_SERVER_HOST", "localhost"],
  relayUrl: "http://YOUR_SERVER_HOST:8888",
  // TURN（音视频通话跨网络中继）—— 需 coturn + 云安全组放行 UDP 3478 + 49160-49200
  turn: {
    urls: ["turn:YOUR_SERVER_HOST:3478?transport=udp", "turn:YOUR_SERVER_HOST:3478?transport=tcp"],
    username: "YOUR_TURN_USER",
    credential: "YOUR_TURN_PASS",
  },
};
