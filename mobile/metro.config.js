const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// 解析 @ensemble/shared-protocol 路径别名
config.resolver.extraNodeModules = {
  "@ensemble/shared-protocol": path.resolve(__dirname, "../shared/src"),
};

// 监听 shared 目录变化
config.watchFolders = [
  path.resolve(__dirname, "../shared/src"),
];

module.exports = config;
