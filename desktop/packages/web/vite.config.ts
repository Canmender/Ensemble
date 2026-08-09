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
});
