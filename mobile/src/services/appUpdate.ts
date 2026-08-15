/**
 * 应用内更新：检查服务器版本 → 下载 APK → 调起系统安装器
 * 服务器 /api/app-version 返回最新版（versionCode 大于当前即有更新），APK 托管在 /apk/
 */
import { Platform } from "react-native";
import * as Application from "expo-application";
import * as IntentLauncher from "expo-intent-launcher";
import * as FileSystem from "expo-file-system/legacy";
import { useDeviceStore } from "../store/deviceStore";
import { useUpdateStore } from "../store/updateStore";

export interface AppUpdateInfo {
  version: string;
  versionCode: number;
  apkUrl: string;
  note: string;
  force: boolean;
}

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

/** 下载新 APK（带进度回调 0~1）并调起系统安装器 */
export async function downloadAndInstall(info: AppUpdateInfo, onProgress?: (p: number) => void): Promise<void> {
  const base = baseUrl();
  if (!base) throw new Error("未连接服务器");
  const url = info.apkUrl.startsWith("http") ? info.apkUrl : base + info.apkUrl;
  const dest = (FileSystem.cacheDirectory ?? "") + "ensemble-update.apk";
  // 清理上次残留的下载文件，避免损坏/续传问题
  try {
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) await FileSystem.deleteAsync(dest);
  } catch {
    /* 忽略清理异常 */
  }
  const download = FileSystem.createDownloadResumable(url, dest, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) {
      onProgress?.(p.totalBytesWritten / p.totalBytesExpectedToWrite);
    }
  });
  const res = await download.downloadAsync();
  if (res?.status !== 200) throw new Error("下载失败");
  // 转成 content:// URI（file:// 在 Android 7+ 触发 FileUriExposedException）
  const contentUri = await FileSystem.getContentUriAsync(dest);
  // FLAG_GRANT_READ_URI_PERMISSION(1) + FLAG_ACTIVITY_NEW_TASK(0x40000000)：
  // 下载完成时应用可能在后台，NEW_TASK 保证安装器能正常启动
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 0x40000001,
  });
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
