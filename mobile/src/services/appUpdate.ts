
/**
 * 应用内更新：检查服务器版本 → 下载 APK（后台/断点续传/等待重连）→ 调起系统安装器
 * 服务器 /api/app-version 返回最新版（versionCode 大于当前即有更新），APK 托管在 /apk/
 */
import { Platform } from "react-native";
import * as Application from "expo-application";
import * as IntentLauncher from "expo-intent-launcher";
import { useDeviceStore } from "../store/deviceStore";
import { useUpdateStore } from "../store/updateStore";
import { startDownload, cancelDownload, installReadyApk, restorePendingDownload, initUpdateDownloader } from "./updateDownloader";

export interface AppUpdateInfo {
  version: string;
  versionCode: number;
  apkUrl: string;
  note: string;
  force: boolean;
}

export { cancelDownload, installReadyApk, restorePendingDownload, initUpdateDownloader };

function baseUrl(): string | null {
  const { connectedDevice } = useDeviceStore.getState();
  if (!connectedDevice) return null;
  return `http://${connectedDevice.ip}:${connectedDevice.httpPort}`;
}

/** 检查服务器是否有新版本；无更新返回 null */
export async function checkAppUpdate(): Promise<AppUpdateInfo | null> {
  if (Platform.OS !== "android") return null;
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(base + "/api/app-version", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: AppUpdateInfo };
    const info = body.data;
    if (!info?.versionCode || !info.apkUrl) return null;
    const current = parseInt(Application.nativeBuildVersion ?? "0", 10) || 0;
    if (info.versionCode > current) return info;
    return null;
  } catch {
    return null;
  }
}

/**
 * 启动更新下载（委托给下载管理器：后台下载 + 断点续传 + 等待重连）。
 * 进度通过 updateStore 反映，由 UpdateManager 展示。
 */
export async function downloadAndInstall(info: AppUpdateInfo): Promise<void> {
  await startDownload(info);
}

/**
 * 设置页/登录后初始化：注册前后台保活，并恢复中断的下载现场（等待重连）。
 */
export async function bootstrapUpdate(): Promise<void> {
  if (Platform.OS !== "android") return;
  initUpdateDownloader();
  await restorePendingDownload();
}

/** 打开系统的「安装未知应用」授权页（Android 8+；下拉到本应用专属开关）。安装失败/被系统拦截时自动引导。 */
export async function openUnknownSourceSettings(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const pkg = Application.applicationId ?? "com.ensemble.mobile";
  try {
    await IntentLauncher.startActivityAsync("android.settings.MANAGE_UNKNOWN_APP_SOURCES", {
      extra: { package: pkg },
    });
    return true;
  } catch {
    try {
      await IntentLauncher.startActivityAsync("android.settings.APPLICATION_DETAILS_SETTINGS", {
        data: "package:" + pkg,
      });
      return true;
    } catch {
      return false;
    }
  }
}

/** 检查更新并弹窗提示（供启动自动检查 / 设置页手动检查调用）；有更新返回 true */
export async function checkAndPromptUpdate(onResult?: (hasUpdate: boolean) => void): Promise<boolean> {
  const info = await checkAppUpdate();
  if (info) {
    useUpdateStore.getState().setUpdateInfo(info);
    onResult?.(true);
    return true;
  }
  onResult?.(false);
  return false;
}
