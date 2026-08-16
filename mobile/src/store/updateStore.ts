
import { create } from "zustand";
import type { AppUpdateInfo } from "../services/appUpdate";

/** 下载阶段：idle 无任务 / downloading 下载中 / waiting_network 等待重连 */
export type UpdatePhase = "idle" | "downloading" | "waiting_network" | "done" | "error";

interface UpdateState {
  updateInfo: AppUpdateInfo | null;
  downloading: boolean;
  progress: number;
  /** 下载阶段（由下载管理器驱动） */
  phase: UpdatePhase;
  /** 已下载字节 */
  downloaded: number;
  /** 总字节 */
  total: number;
  setUpdateInfo: (info: AppUpdateInfo | null) => void;
  setDownloading: (d: boolean) => void;
  setProgress: (p: number) => void;
  /** 下载管理器 → store 状态同步 */
  syncFromDownloader: (phase: UpdatePhase, downloaded: number, total: number, info: AppUpdateInfo | null) => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  updateInfo: null,
  downloading: false,
  progress: 0,
  phase: "idle",
  downloaded: 0,
  total: 0,
  setUpdateInfo: (info) => set({ updateInfo: info }),
  setDownloading: (d) => set({ downloading: d }),
  setProgress: (p) => set({ progress: p }),
  syncFromDownloader: (phase, downloaded, total, info) =>
    set((s) => ({
      phase,
      downloaded,
      total,
      progress: total > 0 ? downloaded / total : s.progress,
      downloading: phase === "downloading" || phase === "waiting_network",
      updateInfo: info ?? s.updateInfo,
    })),
  reset: () => set({ updateInfo: null, downloading: false, progress: 0, phase: "idle", downloaded: 0, total: 0 }),
}));
