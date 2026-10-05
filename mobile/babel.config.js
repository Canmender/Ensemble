module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // 原 react-native-worklets/plugin 随 reanimated 一并移除（2026-10）：
    // reanimated 与 RN 0.86 原生构建不兼容，动画已全部迁往 RN 原生 Animated。
    // 该插件已无存在必要，保留会报 Cannot find module 'react-native-worklets/plugin'。
    plugins: [],
  };
};