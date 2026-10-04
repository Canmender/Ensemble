import { defineConfig } from "vitest/config";

/**
 * 纯函数测试配置（第一层：不引入 DOM 环境）。
 * 组件渲染测试需要 jsdom + @testing-library，属第二层，届时再扩展此配置。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});