import { create } from "zustand";
import type { AppUpdateInfo } from "../services/appUpdate";

interface UpdateState {
  /** 检测到的更新信息（null = 无更新弹窗） */
  updateInfo: AppUpdateInfo | null;
  downloading: boolean;
  progress: number;
  setUpdateInfo: (info: AppUpdateInfo | null) => void;
  setDownloading: (d: boolean) => void;
  setProgress: (p: number) => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  updateInfo: null,
  downloading: false,
  progress: 0,
  setUpdateInfo: (info) => set({ updateInfo: info }),
  setDownloading: (d) => set({ downloading: d }),
  setProgress: (p) => set({ progress: p }),
  reset: () => set({ updateInfo: null, downloading: false, progress: 0 }),
}));
