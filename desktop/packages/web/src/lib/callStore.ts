import { create } from "zustand";

export type CallPhase = "idle" | "calling" | "ringing" | "connecting" | "in-call" | "ended";
export type CallDirection = "incoming" | "outgoing";

export interface CallPeer {
  userId: string;
  name?: string;
}

interface CallState {
  phase: CallPhase;
  direction: CallDirection;
  peer: CallPeer | null;
  reason?: string;
  startCall: (peer: CallPeer) => void;
  incoming: (peer: CallPeer) => void;
  connecting: () => void;
  ringing: () => void;
  connected: () => void;
  ended: (reason?: string) => void;
  reset: () => void;
}

export const useCallStore = create<CallState>((set) => ({
  phase: "idle",
  direction: "outgoing",
  peer: null,
  reason: undefined,
  startCall: (peer) => set({ phase: "calling", direction: "outgoing", peer, reason: undefined }),
  incoming: (peer) => set({ phase: "ringing", direction: "incoming", peer, reason: undefined }),
  connecting: () => set({ phase: "connecting" }),
  ringing: () => set({ phase: "ringing", direction: "outgoing" }),
  connected: () => set({ phase: "in-call" }),
  ended: (reason) => set({ phase: "ended", reason }),
  reset: () => set({ phase: "idle", peer: null, reason: undefined, direction: "outgoing" }),
}));
