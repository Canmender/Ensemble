
/**
 * 应用更新下载管理（单例）
 *
 * 提供「后台下载 / 断点续传 / 等待重连」：
 * - 下载任务挂在模块级单例上，不受页面卸载影响；
 * - 下载中断（网络断开 / 超时 / OOM）时把 expo 的 resumeData + 已下载大小
 *   持久化到 AsyncStorage；
 * - 之后周期探测服务器连通性，恢复后自动用 resumeData 续传（并非重新下载）；
 * - 状态（phase/progress/bytes）写入 updateStore，UI 据此展示
 *   「后台下载中 / 等待重连… / 已下载 X%」。
 */
import { Platform } from "react-native";
import { AppState, type AppStateStatus } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { startActivityAsync as launchIntent } from "expo-intent-launcher";
import { nativeBuildVersion } from "expo-application";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useDeviceStore } from "../store/deviceStore";
import { useUpdateStore, type UpdatePhase } from "../store/updateStore";
import type { AppUpdateInfo } from "./appUpdate";

const LEDGER_KEY = "@ensemble/update_download";

/** 持久化的下载账本：中断后重启 / 等待重连凭此续传 */
interface DownloadLedger {
  info: AppUpdateInfo;
  fileUri: string;
  resumeData: string | null;
  downloaded: number;
  total: number;
  updatedAt: number;
}

interface DownloaderState {
  info: AppUpdateInfo | null;
  phase: UpdatePhase;
  downloaded: number;
  total: number;
}

function serverBase(): string | null {
  const { connectedDevice } = useDeviceStore.getState();
  if (!connectedDevice) return null;
  return `http://${connectedDevice.ip}:${connectedDevice.httpPort}`;
}

/** 下载源 URL（始终带缓存破坏参数，避免旧版命中缓存） */
function apkUrl(info: AppUpdateInfo): string | null {
  const base = serverBase();
  if (!base) return null;
  const u = info.apkUrl.startsWith("http") ? info.apkUrl : base + info.apkUrl;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}v=${info.versionCode}&t=${Date.now()}`;
}

function destPath(info: AppUpdateInfo): string {
  return (FileSystem.cacheDirectory ?? "") + "ensemble-update-" + info.versionCode + ".apk";
}

/** 安全读取文件大小（FileInfo 为存在性联合类型，需收窄） */
type AnyFileInfo = { exists: boolean; size?: number };
function fileSize(stat: AnyFileInfo | null): number {
  return stat && stat.exists && typeof stat.size === "number" ? stat.size : 0;
}

const state: DownloaderState = { info: null, phase: "idle", downloaded: 0, total: 0 };

function push(): void {
  useUpdateStore.getState().syncFromDownloader(state.phase, state.downloaded, state.total, state.info);
}

async function readLedger(): Promise<DownloadLedger | null> {
  try {
    const raw = await AsyncStorage.getItem(LEDGER_KEY);
    return raw ? (JSON.parse(raw) as DownloadLedger) : null;
  } catch {
    return null;
  }
}

async function writeLedger(l: DownloadLedger): Promise<void> {
  try {
    await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(l));
  } catch {
    /* 持久化失败不阻断下载 */
  }
}

async function clearLedger(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEDGER_KEY);
  } catch {
    /* ignore */
  }
}

/** 探测服务器是否可连（下载源连通性，而非通用互联网） */
async function isServerReachable(): Promise<boolean> {
  const base = serverBase();
  if (!base) return false;
  try {
    const res = await fetch(base + "/api/health", { signal: AbortSignal.timeout(6000) });
    return res.ok;
  } catch {
    return false;
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let inflight = false;

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** 等待重连：周期探测服务器，恢复后自动续传 */
function startWaitForReconnect(): void {
  if (state.phase === "waiting_network" && pollTimer) return;
  state.phase = "waiting_network";
  push();
  stopPolling();
  pollTimer = setInterval(async () => {
    if (state.phase !== "waiting_network") {
      stopPolling();
      return;
    }
    const reachable = await isServerReachable();
    if (reachable) {
      stopPolling();
      await run();
    }
  }, 5000);
}

/** 进行中的 task 引用：下载开始后 UI 卸载不影响它 */
let activeTask: FileSystem.DownloadResumable | null = null;

/**
 * 开始（或续传）下载。已存在未完成的账本则自动续传；
 * 下载中断（网络断开等）会转为「等待重连」。
 */
export async function startDownload(info: AppUpdateInfo): Promise<void> {
  if (Platform.OS !== "android") return;
  state.info = info;
  state.phase = "downloading";
  state.downloaded = 0;
  state.total = 0;
  push();
  await run();
}

async function run(): Promise<void> {
  if (inflight || !state.info) return;
  inflight = true;
  try {
    const info = state.info;
    const url = apkUrl(info);
    if (!url) throw new Error("未连接服务器");
    const dest = destPath(info);

    // 尝试读取已有账本（续传），否则全新下载
    const ledger = await readLedger();
    const fileStat = await FileSystem.getInfoAsync(dest).catch(() => null);

    state.total = 0;
    state.downloaded = 0;

    if (ledger && ledger.resumeData && fileSize(fileStat) > 0) {
      // 续传：从上次位置继续
      state.downloaded = fileSize(fileStat);
      activeTask = FileSystem.createDownloadResumable(url, dest, { sessionType: FileSystem.FileSystemSessionType.BACKGROUND }, onProgress, ledger.resumeData);
    } else {
      // 全新下载：清除半成品，重新开始
      if (fileStat?.exists) await FileSystem.deleteAsync(dest).catch(() => {});
      await clearLedger();
      activeTask = FileSystem.createDownloadResumable(url, dest, { sessionType: FileSystem.FileSystemSessionType.BACKGROUND }, onProgress);
    }

    state.phase = "downloading";
    push();

    let result: FileSystem.FileSystemDownloadResult | undefined | null;
    try {
      result = await activeTask.downloadAsync();
    } catch (err) {
      // 下载中断（网络断开/超时/进程回收等）：捕获 resumeData 持久化，进入等待重连
      await persistResume(activeTask, dest, info);
      state.phase = "waiting_network";
      push();
      startWaitForReconnect();
      return;
    }

    if (!result || result.status !== 200) {
      throw new Error("下载失败");
    }

    // 完成校验：APK 应远大于 20MB
    const finalStat = await FileSystem.getInfoAsync(dest);
    if (fileSize(finalStat) < 20 * 1024 * 1024) {
      throw new Error("下载文件异常，请重试");
    }

    // 完成：清账本、标记 done、调起安装器
    await clearLedger();
    activeTask = null;
    state.phase = "done";
    state.downloaded = fileSize(finalStat);
    state.total = fileSize(finalStat);
    push();
    await launchInstaller(dest);
  } catch (e) {
    // 明确的失败（如服务器返回错误）：标记 error 并向上抛出供 UI 提示
    state.phase = "error";
    push();
    throw e;
  } finally {
    inflight = false;
  }
}

/** 进度回调：更新 store（下载中 / 后台均反映） */
function onProgress(p: FileSystem.DownloadProgressData): void {
  if (!state.info || state.phase !== "downloading") return;
  if (p.totalBytesExpectedToWrite > 0) {
    state.total = p.totalBytesExpectedToWrite;
    state.downloaded = p.totalBytesWritten;
    push();
  }
}

/** 中断时捕获 resumeData 入库，供断点续传 */
async function persistResume(task: FileSystem.DownloadResumable | null, fileUri: string, info: AppUpdateInfo): Promise<void> {
  try {
    if (task) {
      // pauseAsync 能拿到 curl 续传所需的 resumeData；失败则用当前 savable()
      try {
        const p = await task.pauseAsync();
        const stat = await FileSystem.getInfoAsync(fileUri).catch(() => null);
        await writeLedger({
          info,
          fileUri,
          resumeData: p.resumeData ?? null,
          downloaded: fileSize(stat),
          total: 0,
          updatedAt: Date.now(),
        });
      } catch {
        const s = task.savable();
        const stat = await FileSystem.getInfoAsync(fileUri).catch(() => null);
        await writeLedger({
          info,
          fileUri,
          resumeData: s.resumeData ?? null,
          downloaded: fileSize(stat),
          total: 0,
          updatedAt: Date.now(),
        });
      }
    }
  } catch {
    /* 忽略 */
  }
}

async function launchInstaller(dest: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(dest);
  await launchIntent("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 0x40000001, // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK
  });
}

/** 初始化：AppState 前后台保活 + 启动时恢复中断的下载（等待重连） */
export function initUpdateDownloader(): void {
  if (Platform.OS !== "android" || appStateSub) return;
  appStateSub = AppState.addEventListener("change", (_s: AppStateStatus) => {
    // 回到前台且处于等待重连时，立即探测一次
    if (state.phase === "waiting_network") {
      void (async () => {
        if (await isServerReachable()) {
          stopPolling();
          await run();
        }
      })();
    }
  });
}

/** 用户取消（非强制）：停止等待、清账本、清半成品 */
export async function cancelDownload(): Promise<void> {
  stopPolling();
  if (activeTask) {
    try { await activeTask.cancelAsync(); } catch { /* ignore */ }
    activeTask = null;
  }
  const file = state.info ? destPath(state.info) : null;
  state.info = null;
  state.phase = "idle";
  state.downloaded = 0;
  state.total = 0;
  await clearLedger();
  if (file) await FileSystem.deleteAsync(file).catch(() => {});
  push();
}

/** 启动时调用：如果有未完成的下载账本，进入等待重连（恢复现场） */
export async function restorePendingDownload(): Promise<void> {
  if (Platform.OS !== "android") return;
  const ledger = await readLedger();
  if (!ledger) return;
  const current = parseInt(nativeBuildVersion ?? "0", 10) || 0;
  if (ledger.info.versionCode <= current) {
    await clearLedger();
    return;
  }
  state.info = ledger.info;
  state.downloaded = ledger.downloaded;
  state.phase = "waiting_network";
  push();
  startWaitForReconnect();
}
