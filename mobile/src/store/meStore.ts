import { create } from "zustand";
import { api, type UserInfo } from "../services/api";

interface MeState {
  me: UserInfo | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** 当前登录用户（全局共享，昵称/头像更新后 reload 刷新各页） */
export const useMeStore = create<MeState>((set) => ({
  me: null,
  loading: false,
  reload: async () => {
    set({ loading: true });
    try {
      const res = await api.getMe();
      set({ me: res.data ?? null });
    } catch {
      set({ me: null });
    } finally {
      set({ loading: false });
    }
  },
}));
