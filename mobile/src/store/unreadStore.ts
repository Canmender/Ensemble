/**
 * 未读状态（全局）：底部 Tab 红点 + 通知判断用
 * - totalUnread：未读消息总数（列表加载时以服务端为准覆盖）
 * - lastActiveConvId：当前打开的会话 runId（该会话的新消息不弹通知、不计未读）
 */
import { create } from "zustand";

interface UnreadState {
  totalUnread: number;
  lastActiveConvId: string | null;
  setTotalUnread: (n: number) => void;
  setLastActiveConvId: (id: string | null) => void;
  addUnread: () => void;
}

export const useUnreadStore = create<UnreadState>((set) => ({
  totalUnread: 0,
  lastActiveConvId: null,
  setTotalUnread: (n) => set({ totalUnread: n }),
  setLastActiveConvId: (id) => set({ lastActiveConvId: id }),
  addUnread: () => set((s) => ({ totalUnread: s.totalUnread + 1 })),
}));
