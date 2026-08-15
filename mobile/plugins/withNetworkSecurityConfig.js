/**
 * 固化 Android 网络安全配置（network_security_config.xml）
 *
 * 背景：自用云端服务器为明文 HTTP，Android 9+ 默认禁止明文流量。此前手动加到构建
 * 目录的 network_security_config.xml 会在 expo prebuild --clean 时丢失（构建目录
 * gitignore）。本 plugin 在 prebuild 时自动生成 xml + 在 AndroidManifest 引用。
 *
 * 放行域名来自本地 gitignore 的 server.config.js（见 server.config.example.js 模板）；
 * 真实服务器 IP / 域名仅存于本地，不会提交到 GitHub。
 */

const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/** 从本地 gitignore 配置读取明文放行域名；缺失时退回占位符（仅示例，不会暴露真实服务器）。 */
function loadCleartextDomains() {
  const cfgPath = path.join(__dirname, "..", "server.config.js");
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = require(cfgPath);
      if (Array.isArray(cfg.cleartextDomains) && cfg.cleartextDomains.length) {
        return cfg.cleartextDomains;
      }
    }
  } catch {
    /* 本地无配置时用占位符 */
  }
  return ["YOUR_SERVER_HOST", "localhost"];
}

function NETWORK_SECURITY_XML(domains) {
  const rows = domains
    .map((d) => `        <domain includeSubdomains="true">${d}</domain>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
${rows}
    </domain-config>
</network-security-config>
`;
}

module.exports = function withNetworkSecurityConfig(config) {
  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) {
      app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    }
    return config;
  });

  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, "network_security_config.xml"), NETWORK_SECURITY_XML(loadCleartextDomains()));
      return config;
    },
  ]);

  return config;
};
