import React, { createContext, useContext, useEffect, useState } from "react";
import { clearSessionToken, hasUserToken, setSessionToken } from "./token";
import { getMode } from "./mode";
import { getCloudBase } from "./apiBase";

export interface AuthUser {
  id: string;
  username: string;
  displayName?: string;
  role: string;
  orgId?: string;
  avatarUrl?: string;
}

/** 登录态：loading 判定中 / authenticated 已登录 / local 本地桌面模式（免登录）/ guest 需登录 */
type AuthStatus = "loading" | "authenticated" | "local" | "guest";

interface AuthState {
  status: AuthStatus;
  user?: AuthUser;
}

interface AuthContextValue {
  state: AuthState;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  state: { status: "loading" },
  login: () => {},
  logout: () => {},
});

/** 全局认证上下文：判定登录态（用户 token / 本地桌面模式 / 未登录） */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // ① 有持久化用户 token → 验证 /api/auth/me
      if (hasUserToken()) {
        try {
          const token = localStorage.getItem("ensemble.auth.token");
          const base = await getCloudBase();
          const res = await fetch(`${base}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const json = (await res.json()) as { data?: AuthUser };
            if (!cancelled && json.data) setState({ status: "authenticated", user: json.data });
            return;
          }
          clearSessionToken();
        } catch {
          /* 网络失败，回退到本地判定 */
        }
      }

      // ② 本地桌面模式：/api/ws-token 可达（无 apiKey 的本地 server）
      //    多端协作模式跳过 → 走云端登录（guest 需登录）
      if (getMode() !== "multi") {
        try {
          const res = await fetch("/api/ws-token");
          if (res.ok && !cancelled) {
            setState({ status: "local" });
            return;
          }
        } catch {
          /* ignore */
        }
      }

      // ③ 未登录（服务器模式）
      if (!cancelled) setState({ status: "guest" });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = (token: string, user: AuthUser) => {
    setSessionToken(token);
    setState({ status: "authenticated", user });
  };

  const logout = () => {
    const token = localStorage.getItem("ensemble.auth.token");
    if (token) {
      void (async () => {
        const base = await getCloudBase();
        await fetch(`${base}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      })();
    }
    clearSessionToken();
    setState({ status: "local" });
    window.location.href = "/";
  };

  return <AuthContext.Provider value={{ state, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}