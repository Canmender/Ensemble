/**
 * 合鸣移动端入口
 * 先初始化全局 polyfills（Node.js Buffer），再挂载 App。
 * WebCrypto 由 @peculiar/webcrypto 在 e2eService 内注入 libsignal，无需全局 polyfill。
 * TextDecoder 补丁在 App.tsx 顶部（必须晚于 expo winter 的 installGlobal，见彼处注释）。
 */
import { Buffer } from "buffer";
import "process";

// Node.js 全局 polyfill：部分依赖（如 libsignal 生态）期望全局 Buffer
(globalThis as any).Buffer = Buffer;

import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
