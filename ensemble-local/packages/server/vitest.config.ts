import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    server: {
      deps: {
        // node:sqlite 是 Node 内置模块，避免 vitest 尝试解析为外部包
        external: [/node:sqlite/],
      },
    },
  },
});
