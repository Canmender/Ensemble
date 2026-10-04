/**
 * 固化 newArchEnabled=false（关闭 React Native 新架构）
 *
 * 背景：Android 16 上启用新架构（bridgeless）会导致应用白屏。开关实际落在
 * android/gradle.properties，而该文件是 expo prebuild 的产物、每次
 * `expo prebuild --clean` 都会被重新覆写，手改无效。Expo SDK 57 的 app.json
 * 配置类型里没有 newArchEnabled 字段（在 android 段写它会被静默忽略），因此
 * 用 config plugin 在 prebuild 时改写 gradle.properties。
 *
 * 关闭新架构后 TurboModules/Fabric 不可用，走旧桥接层。
 */

const { withGradleProperties } = require("@expo/config-plugins");

module.exports = function withNewArchDisabled(config) {
  return withGradleProperties(config, (config) => {
    const items = config.modResults;
    const existing = items.find((item) => item.key === "newArchEnabled");
    if (existing) {
      existing.value = "false";
    } else {
      items.push({ type: "property", key: "newArchEnabled", value: "false" });
    }
    return config;
  });
};
