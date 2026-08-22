import { create } from "zustand";
import type { MediaStream } from "react-native-webrtc";

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
  /** 是否视频通话 */
  video: boolean;
  /** 本端麦克风/摄像头开关（视频通话控制用） */
  micOn: boolean;
  camOn: boolean;
  /** 本地/远端媒体流（供 CallModal 渲染 RTCView；由 callService 维护） */
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** 就近一次错误/结束原因 */
  reason?: string;
  /** 拨号/接听/挂断/拒接动作 */
  startCall: (peer: CallPeer, video?: boolean) => void;
  incoming: (peer: CallPeer, video?: boolean) => void;
  accepted: () => void;
  ringing: () => void;
  connected: () => void;
  ended: (reason?: string) => void;
  register: (p: CallPeer, dir: CallDirection) => void;
  setMedia: (partial: { localStream?: MediaStream | null; remoteStream?: MediaStream | null }) => void;
  setMicOn: (on: boolean) => void;
  setCamOn: (on: boolean) => void;
  setVideo: (video: boolean) => void;
  reset: () => void;
}

export const useCallStore = create<CallState>((set) => ({
  phase: "idle",
  direction: "outgoing",
  peer: null,
  video: false,
  micOn: true,
  camOn: true,
  localStream: null,
  remoteStream: null,
  reason: undefined,
  startCall: (peer, video) => set({ phase: "calling", direction: "outgoing", peer, video: !!video, micOn: true, camOn: true, reason: undefined }),
  incoming: (peer, video) => set({ phase: "ringing", direction: "incoming", peer, video: !!video, micOn: true, camOn: true, reason: undefined }),
  accepted: () => set({ phase: "connecting" }),
  ringing: () => set({ phase: "ringing", direction: "outgoing" }),
  connected: () => set({ phase: "in-call" }),
  ended: (reason) => set({ phase: "ended", reason }),
  register: (peer, direction) => set({ peer, direction, reason: undefined }),
  setMedia: (partial) => set(partial),
  setMicOn: (on) => set({ micOn: on }),
  setCamOn: (on) => set({ camOn: on }),
  setVideo: (video) => set({ video }),
  reset: () => set({ phase: "idle", peer: null, reason: undefined, direction: "outgoing", video: false, localStream: null, remoteStream: null }),
}));
