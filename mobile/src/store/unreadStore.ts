/**
 * 未读状态（全局）：底部 Tab 红点 + 通知判断用
 * - totalUnread：未读消息总数（列表加载时以服务端为准覆盖）
 * - lastActiveConvId：当前打开的会话 runId（该会话的新消息不弹通知、不计未读）
 * - mutedRunIds：静音会话的 runId 集合（静音会话不弹通知）
 */
import { create } from "zustand";

interface UnreadState {
  totalUnread: number;
  lastActiveConvId: string | null;
  mutedRunIds: Set<string>;
  setTotalUnread: (n: number) => void;
  setLastActiveConvId: (id: string | null) => void;
  setMutedRunIds: (ids: Set<string>) => void;
  addUnread: () => void;
}

export const useUnreadStore = create<UnreadState>((set) => ({
  totalUnread: 0,
  lastActiveConvId: null,
  mutedRunIds: new Set(),
  setTotalUnread: (n) => set({ totalUnread: n }),
  setLastActiveConvId: (id) => set({ lastActiveConvId: id }),
  setMutedRunIds: (ids) => set({ mutedRunIds: ids }),
  addUnread: () => set((s) => ({ totalUnread: s.totalUnread + 1 })),
}));
