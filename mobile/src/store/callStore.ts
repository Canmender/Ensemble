import { create } from "zustand";

export type CallDirection = "incoming" | "outgoing";
export type CallPhase = "idle" | "calling" | "ringing" | "connecting" | "in-call" | "ended" | "rejected" | "missed";

export interface CallPeer {
  userId: string;
  name?: string;
}

interface CallState {
  /** 当前通话阶段 */
  phase: CallPhase;
  direction: CallDirection;
  peer: CallPeer | null;
  /** 就近一次错误/结束原因 */
  reason?: string;
  /** 拨号/接听/挂断/拒接动作 */
  startCall: (peer: CallPeer) => void;
  incoming: (peer: CallPeer) => void;
  accepted: () => void;
  ringing: () => void;
  connected: () => void;
  ended: (reason?: string) => void;
  register: (p: CallPeer, dir: CallDirection) => void;
  reset: () => void;
}

export const useCallStore = create<CallState>((set) => ({
  phase: "idle",
  direction: "outgoing",
  peer: null,
  reason: undefined,
  startCall: (peer) => set({ phase: "calling", direction: "outgoing", peer, reason: undefined }),
  incoming: (peer) => set({ phase: "ringing", direction: "incoming", peer, reason: undefined }),
  accepted: () => set({ phase: "connecting" }),
  ringing: () => set({ phase: "ringing", direction: "outgoing" }),
  connected: () => set({ phase: "in-call" }),
  ended: (reason) => set({ phase: "ended", reason }),
  register: (peer, direction) => set({ peer, direction, reason: undefined }),
  reset: () => set({ phase: "idle", peer: null, reason: undefined, direction: "outgoing" }),
}));
