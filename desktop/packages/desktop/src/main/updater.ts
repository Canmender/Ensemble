/**
 * 桌面端自动更新（自研轻量方案，与移动端 UpdateManager 行为对齐）。
 *
 * 通道：云端服务器 GET /api/app-version/desktop（apkDir/desktop.json + setup.exe 同目录）。
 * 不走 GitHub Releases——GitHub 在本网络环境持续不可达。
 * 仅云端版启用（本地版离线无更新源）。启动 30s 后首检 + 每 4h；
 * 有新版本发 update:available 给渲染层提示；用户确认后下载 setup.exe → 拉起安装器 → 退出。
 */
import { app, BrowserWindow, ipcMain, net } from "electron";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { cloudBaseUrl } from "./localSettings";
import { IPC } from "../shared/ipc";

const CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export interface UpdateInfo {
  available: boolean;
  version?: string;
  note?: string;
  force?: boolean;
}

interface DesktopVersionMeta {
  version?: string;
  url?: string;
  size?: number;
  note?: string;
  force?: boolean;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function fetchJson(url: string): Promise<DesktopVersionMeta> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DesktopVersionMeta;
}

async function checkOnce(currentVersion: string): Promise<UpdateInfo> {
  try {
    const base = cloudBaseUrl();
    if (!base) return { available: false };
    const meta = await fetchJson(`${base}/api/app-version/desktop`);
    if (!meta?.version || !meta.url) return { available: false };
    if (compareVersions(meta.version, currentVersion) <= 0) return { available: false };
    return { available: true, version: meta.version, note: meta.note, force: meta.force };
  } catch {
    return { available: false };
  }
}

/** 下载安装包到临时目录 → 拉起 NSIS 安装器 → 本进程退出让出句柄 */
async function downloadAndInstall(version: string, onProgress: (r: number, t: number) => void): Promise<string> {
  const base = cloudBaseUrl();
  if (!base) throw new Error("未配置云端地址");
  const meta = await fetchJson(`${base}/api/app-version/desktop`);
  if (!meta?.url || meta.version !== version) throw new Error("更新元数据已变化，请重新检查");
  const url = /^https?:\/\//i.test(meta.url) ? meta.url : `${base}${meta.url.startsWith("/") ? "" : "/"}${meta.url}`;
  const dest = join(tmpdir(), `ensemble-setup-${version}.exe`);

  // 断点续传：目标已存在且大小与元数据一致则跳过下载（失败重试场景）
  if (!(meta.size && meta.size > 0 && existsSync(dest) && statSync(dest).size === meta.size)) {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length") ?? meta.size ?? 0);
    let received = 0;
    const reader = res.body.getReader();
    const out = createWriteStream(dest);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value)) {
        await new Promise<void>((resolve) => out.once("drain", resolve));
      }
      received += value.byteLength;
      onProgress(received, total);
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on("error", reject);
    });
  }

  const child = spawn(dest, [], { detached: true, stdio: "ignore" });
  child.unref();
  if (!child.pid) throw new Error("无法启动安装程序");
  setTimeout(() => app.quit(), 500);
  return dest;
}

let lastCheck: UpdateInfo = { available: false };

/**
 * 注册 IPC 与定时检查。仅云端版调用。
 * 渲染层接口：invoke(updateCheck) 手动检查 / invoke(updateInstall, version)
 * / on("update:available", cb) 被动通知。
 */
export function registerAutoUpdater(currentVersion: string): void {
  ipcMain.handle(IPC.updateCheck, async () => {
    lastCheck = await checkOnce(currentVersion);
    return lastCheck;
  });
  ipcMain.handle(IPC.updateInstall, async (e, version: unknown) => {
    if (typeof version !== "string" || !version) throw new Error("version 非法");
    const win = BrowserWindow.fromWebContents(e.sender);
    return downloadAndInstall(version, (received, total) => {
      win?.webContents.send("update:progress", { received, total });
    });
  });

  const timer = setTimeout(async () => {
    lastCheck = await checkOnce(currentVersion);
    if (lastCheck.available) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("update:available", lastCheck);
      }
    }
  }, CHECK_DELAY_MS);
  timer.unref?.();
  setInterval(async () => {
    const info = await checkOnce(currentVersion);
    if (info.available && info.version !== lastCheck.version) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("update:available", info);
      }
    }
    lastCheck = info;
  }, CHECK_INTERVAL_MS).unref?.();
}
