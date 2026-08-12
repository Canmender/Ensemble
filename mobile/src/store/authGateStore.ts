import { create } from "zustand";

/** 应用登录门禁：loading 判定中 / in 已登录进主界面 / out 未登录进登录页 */
export type AuthGate = "loading" | "in" | "out";

interface AuthGateState {
  gate: AuthGate;
  setGate: (g: AuthGate) => void;
}

export const useAuthGate = create<AuthGateState>((set) => ({
  gate: "loading",
  setGate: (g) => set({ gate: g }),
}));
