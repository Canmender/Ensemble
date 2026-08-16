module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Reanimated 4 / react-native-worklets 必配（否则 worklet 动画在运行时挂掉）
      "react-native-worklets/plugin",
    ],
  };
};
