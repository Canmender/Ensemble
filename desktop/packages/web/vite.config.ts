import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发期把 /api 与 /ws 代理到后端
export default defineConfig({
  plugins: [react()],
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
    rollupOptions: {
      output: {
        manualChunks: {
          // 框架层：变更频率低，长期缓存
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // reactflow 体量大，单独拆分（已被路由懒加载隔离）
          "vendor-flow": ["reactflow"],
        },
      },
    },
  },
});
