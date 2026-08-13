/**
 * 固化 Android 网络安全配置（network_security_config.xml）
 *
 * 背景：自用云端服务器当前为明文 HTTP（http://SERVER_IP_REDACTED:8787），
 * Android 9+ 默认禁止明文流量。此前手动加到构建目录的 network_security_config.xml
 * 会在 expo prebuild --clean 时丢失（构建目录 gitignore）。本 plugin 在 prebuild
 * 时自动生成 xml + 在 AndroidManifest 引用，保证重新 prebuild 后不丢。
 *
 * 放行清单：自用服务器 IP / 备案域名 / localhost 明文，其余仍强制 HTTPS。
 */

const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const NETWORK_SECURITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">SERVER_IP_REDACTED</domain>
        <domain includeSubdomains="true">DOMAIN_REDACTED</domain>
        <domain includeSubdomains="true">localhost</domain>
    </domain-config>
</network-security-config>
`;

module.exports = function withNetworkSecurityConfig(config) {
  // 1. AndroidManifest 引用 @xml/network_security_config
  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) {
      app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    }
    return config;
  });

  // 2. 写入 res/xml/network_security_config.xml
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
      fs.writeFileSync(path.join(xmlDir, "network_security_config.xml"), NETWORK_SECURITY_XML);
      return config;
    },
  ]);

  return config;
};
