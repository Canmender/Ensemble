import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发期把 /api 与 /ws 代理到后端
export default defineConfig({
  plugins: [react()],
  // 相对路径 base：构建产物可在 file:// 或子路径下加载（Electron prod 同源托管）
  base: "./",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
  build: {
    // 目标 es2022：可安全使用结构化克隆、Object.hasOwn 等现代特性
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          // 框架层：变更频率低，长期缓存
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // @xyflow/react 体量大，单独拆分（已被路由懒加载隔离）
          "vendor-flow": ["@xyflow/react"],
        },
      },
    },
  },
});
