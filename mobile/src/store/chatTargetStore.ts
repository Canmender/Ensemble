import { create } from "zustand";

/** 联系人标签页选中的聊天目标（跨标签传递给 ChatPage） */
export interface ChatTarget {
  kind: "user" | "agent";
  id: string;
  name: string;
}

interface ChatTargetState {
  target: ChatTarget | null;
  setTarget: (t: ChatTarget | null) => void;
}

/** 联系人 → 聊天的跨标签通信：Contacts 页设置目标，Chat 页消费后清除 */
export const useChatTarget = create<ChatTargetState>((set) => ({
  target: null,
  setTarget: (t) => set({ target: t }),
}));
