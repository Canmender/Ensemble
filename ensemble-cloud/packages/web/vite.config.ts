import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 云端代理目标：从环境变量读取（勿硬编码真实 IP，见隐私约定），未设置时回退本地
const cloudOrigin = process.env.CLOUD_API_ORIGIN ?? "http://localhost:8787";

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
      // 代理云端服务器请求（避免 CORS 问题）
      // /cloud-api/api/* -> $CLOUD_API_ORIGIN/api/*
      "/cloud-api/api": {
        target: cloudOrigin,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cloud-api\/api/, "/api"),
      },
      // 代理云端服务器的上传文件（头像等）
      "/uploads": {
        target: cloudOrigin,
        changeOrigin: true,
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