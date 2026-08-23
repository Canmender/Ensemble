const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// 解析 @ensemble/shared 路径别名（直接吃 TS 源码，与桌面端 pnpm workspace 同源）
config.resolver.extraNodeModules = {
  "@ensemble/shared": path.resolve(__dirname, "../desktop/packages/shared/src"),
};

// 监听 shared 目录变化
config.watchFolders = [
  path.resolve(__dirname, "../desktop/packages/shared/src"),
];

// RN 不认识 node: 前缀的内置模块引用（@peculiar/webcrypto 等生态包会用到），
// 映射到 npm polyfill 包；metro 自身对裸名 buffer/process 也需显式指路
config.resolver.extraNodeModules["node:buffer"] = path.resolve(__dirname, "node_modules/buffer");
config.resolver.extraNodeModules["node:process"] = path.resolve(__dirname, "node_modules/process");
config.resolver.extraNodeModules["node:crypto"] = path.resolve(__dirname, "node_modules/resolve-args-placeholder") /* 占位，见下方 redirect */;
// Metro 无条件重映射：node:crypto 指向一个空模块（peculiar 在 RN 分支不用它的同步 API，
// 但 import 语句必须可解析）。用 resolveRequest 拦截更干净：
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "node:crypto") {
    // @peculiar/webcrypto 仅在非浏览器环境探测里引用 node:crypto，RN 上运行时不走该分支；
    // 提供空实现满足静态解析
    return { type: "empty" };
  }
  // shared 源码（watchFolders 内）的裸名依赖（zod 等）：metro 以 originModulePath
  // 向上找 node_modules，找不到 mobile 的平面安装。统一重定向到 mobile 的 node_modules。
  if (!moduleName.startsWith(".") && !moduleName.startsWith("@ensemble/") && !path.isAbsolute(moduleName)) {
    const fallback = path.resolve(__dirname, "node_modules", moduleName);
    if (require("fs").existsSync(fallback)) {
      return context.resolveRequest(
        { ...context, originModulePath: path.resolve(__dirname, "index.ts") },
        moduleName,
        platform,
      );
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
