import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import { EDITION_LABEL, parseEditionArg, type Edition } from "../shared/edition";

// 版本由主进程经 additionalArguments 注入（本地版/云端版，决定前端运行模式）
const edition: Edition = parseEditionArg(process.argv) ?? "local";

/**
 * 渲染进程安全桥：仅暴露最小必要能力。
 * api.ts/ws.ts 走相对路径的本地同源 HTTP/WS，无需在此暴露 HTTP 客户端。
 */
contextBridge.exposeInMainWorld("desktop", {
  version: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  platform: process.platform,
  /** 当前版本：local=本地版 / cloud=云端版 */
  edition,
  editionLabel: EDITION_LABEL[edition],
  /** 云端地址连通性测试（主进程 net.fetch，绕开渲染层 CSP） */
  testCloudHost: (host: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.testCloudHost, host),
  /** 自动更新（仅云端版启用；本地版调用返回不可用） */
  updateCheck: (): Promise<{ available: boolean; version?: string; note?: string }> =>
    ipcRenderer.invoke(IPC.updateCheck),
  updateInstall: (version: string): Promise<string> => ipcRenderer.invoke(IPC.updateInstall, version),
  onUpdateAvailable: (cb: (info: { available: boolean; version?: string; note?: string }) => void) => {
    ipcRenderer.on("update:available", (_e, info) => cb(info));
  },
  onUpdateProgress: (cb: (p: { received: number; total: number }) => void) => {
    ipcRenderer.on("update:progress", (_e, p) => cb(p));
  },
  /** 工具执行确认对话框（P2 工具安全用） */
  confirmTool: (tool: string, args: unknown): Promise<boolean> =>
    ipcRenderer.invoke(IPC.confirmTool, { tool, args }),
  openConfigDir: (): Promise<string> => ipcRenderer.invoke(IPC.openConfigDir),
  /** 原生窗口控制 */
  controls: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.winMinimize),
    maximize: (): Promise<void> => ipcRenderer.invoke(IPC.winMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.winClose),
  },
  /** 系统信息 */
  systemInfo: (): Promise<Record<string, unknown>> => ipcRenderer.invoke(IPC.systemInfo),
  /** 开机自启 */
  setAutoLaunch: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.setAutoLaunch, enabled),
  isAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke(IPC.isAutoLaunch),
});
