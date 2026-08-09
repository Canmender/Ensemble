/** 库入口：桌面壳 / CLI 消费的 API（index.ts 是独立启动入口） */
export * from "./electron";
export * from "./context";
export * from "./keychain";
export * from "./tools";
export { logger } from "./util/logger";
export type { AgentAdapter, AgentTaskInput } from "./adapters/types";
