/** Type declarations for the Electron preload API exposed on `window.desktop` */

export {};

declare global {
  interface DesktopSystemInfo {
    platform: string;
    arch: string;
    uptime: number;
    versions: {
      electron: string;
      node: string;
      chrome: string;
    };
  }

  interface DesktopAPI {
    /** Whether auto-launch on login is enabled */
    isAutoLaunch?(): Promise<boolean>;
    /** Enable or disable auto-launch on login */
    setAutoLaunch?(enable: boolean): Promise<boolean>;
    /** Get system information (platform, arch, uptime, versions) */
    systemInfo?(): Promise<DesktopSystemInfo>;
    /** Open the configuration directory in the system file manager */
    openConfigDir?(): Promise<void>;
  }

  interface Window {
    desktop?: DesktopAPI;
  }
}
