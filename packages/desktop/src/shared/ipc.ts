/** IPC 通道常量（preload 与 main 共用） */
export const IPC = {
  appVersion: "app:version",
  confirmTool: "app:confirm-tool",
  openConfigDir: "app:open-config-dir",
  getSecret: "secrets:get",
  setSecret: "secrets:set",
  winMinimize: "win:minimize",
  winMaximize: "win:maximize",
  winClose: "win:close",
  systemInfo: "app:system-info",
  setAutoLaunch: "app:set-auto-launch",
  isAutoLaunch: "app:is-auto-launch",
} as const;
