import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { applyTheme, getStoredTheme } from "./lib/theme";
import { useMode } from "./lib/mode";
import "./index.css";

// 在渲染前应用已保存的主题，避免闪屏
applyTheme(getStoredTheme());

function Root() {
  // 模式变化时用 key 重建 AuthProvider，使其重新判定登录态（本地 vs 云端登录）
  const mode = useMode();
  return (
    <BrowserRouter>
      <AuthProvider key={mode ?? "none"}>
        <App />
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
