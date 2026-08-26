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
  /** 云端地址连通性测试（主进程 net.fetch，绕开渲染层 CSP——新地址尚未入白名单） */
  testCloudHost: "app:test-cloud-host",
  /** 自动更新：检查新版本 / 下载并拉起安装器 */
  updateCheck: "update:check",
  updateInstall: "update:install",
  /**
   * 云端 HTTP 代理：renderer 经主进程 net.fetch 访问云端（multi 模式）。
   * 绕开 renderer CSP/webRequest 对跨源请求的拦截——桌面端同源只与本机 server
   * 通信，云端访问统一走此通道（登录/注册/插件管理等全部 REST）。
   */
  cloudFetch: "cloud:fetch",
} as const;
