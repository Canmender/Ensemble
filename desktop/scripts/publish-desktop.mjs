/**
 * 桌面端发布脚本：双安装包 → 云端服务器 apkDir → 写 desktop.json → 只保留最近两个版本。
 *
 * 策略（用户 2026-08-23 确定，见记忆 desktop-update-policy）：
 * - 云端存储优先：更新通道走自有云服务器 apkDir（与移动端 APK 同目录），不用 GitHub
 * - 最多保留两个安装包：上传成功后删除更早版本的 exe/blockmap（保留最新+次新供回滚）
 *
 * 用法：
 *   node scripts/publish-desktop.mjs --host <ip> --user root [--port 22] [--editions local,cloud]
 * 前置：先跑 pnpm package:local / package:cloud 产出 release/*.exe
 * 凭据走 ssh 默认认证（密钥/agent）；不在此处传密码（隐私约定）。
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(pkgRoot, "release");

// ---------- 参数 ----------
const args = process.argv.slice(2);
function argOf(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const host = argOf("--host");
const user = argOf("--user") ?? "root";
const sshPort = argOf("--port") ?? "22";
const editions = (argOf("--editions") ?? "local,cloud").split(",").map((s) => s.trim());
if (!host) {
  console.error("用法: node scripts/publish-desktop.mjs --host <服务器IP> [--user root] [--editions local,cloud]");
  process.exit(1);
}
/** 服务器 apkDir 容器路径（docker compose 挂载名与移动端一致；如不同用 --apk-dir 覆盖） */
const APK_DIR = argOf("--apk-dir") ?? "/opt/ensemble/apk";

// ---------- 收集产物 ----------
const version = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;
const artifacts = [];
for (const ed of editions) {
  const name = `合鸣-${ed === "cloud" ? "云端版" : "本地版"}-${version}-setup.exe`;
  const p = join(releaseDir, name);
  if (!existsSync(p)) {
    console.error(`缺少产物: ${p}\n先运行: pnpm package:${ed}`);
    process.exit(1);
  }
  artifacts.push({ edition: ed, name, path: p, size: statSync(p).size });
}

console.log(`发布 v${version}（${artifacts.map((a) => a.edition).join("/")}）→ ${host}:${APK_DIR}`);

function ssh(cmd, opts = {}) {
  execFileSync("ssh", ["-p", sshPort, "-o", "BatchMode=yes", `${user}@${host}`, cmd], { stdio: opts.quiet ? "pipe" : "inherit" });
}
function scp(localPath, remotePath) {
  execFileSync("scp", ["-P", sshPort, "-o", "BatchMode=yes", localPath, `${user}@${host}:${remotePath}`], { stdio: "inherit" });
}

// ---------- 上传 + 元数据 + 两包保留策略 ----------
try {
  // 1. 上传安装包
  for (const a of artifacts) {
    console.log(`↑ ${a.name} (${(a.size / 1048576).toFixed(1)} MB)`);
    scp(a.path, `${APK_DIR}/${a.name}`);
  }

  // 2. 两包保留：列出 apkDir 里全部桌面安装包，按版本排序，删掉本次之外的旧版（保留次新做回滚）
  //    文件名形态: 合鸣-(本地|云端)版-x.y.z-setup.exe —— 按 (edition, version) 分组各留两包
  const listOutput = execFileSync(
    "ssh",
    ["-p", sshPort, "-o", "BatchMode=yes", `${user}@${host}`,
     `ls -1 ${APK_DIR} | grep -E '^合鸣-(本地|云端)版-[0-9.]+-setup\\.exe$' || true`],
    { encoding: "utf8" },
  ).trim();
  const remoteFiles = listOutput ? listOutput.split("\n").filter(Boolean) : [];
  const verOf = (f) => (f.match(/-([0-9.]+)-setup\.exe$/) ?? [])[1] ?? "";
  const cmpVer = (a, b) => {
    const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d) return d;
    }
    return 0;
  };
  const byEdition = new Map();
  for (const f of remoteFiles) {
    const ed = f.includes("云端版") ? "cloud" : "local";
    if (!byEdition.has(ed)) byEdition.set(ed, []);
    byEdition.get(ed).push(f);
  }
  const toDelete = [];
  for (const [ed, files] of byEdition) {
    files.sort((a, b) => cmpVer(verOf(b), verOf(a))); // 新→旧
    toDelete.push(...files.slice(2)); // 留两包，其余删
  }
  if (toDelete.length > 0) {
    console.log(`清理旧包（每版本只留两个）: ${toDelete.join(", ")}`);
    ssh(`cd ${APK_DIR} && rm -f ${toDelete.map((f) => `'${f}'`).join(" ")}`, { quiet: true });
    // 同名 blockmap 一并清
    ssh(`cd ${APK_DIR} && rm -f ${toDelete.map((f) => `'${f}.blockmap'`).join(" ")}`, { quiet: true });
  }

  // 3. 写 desktop.json（云端版为更新源主体；本地版离线不消费）
  const cloudArt = artifacts.find((a) => a.edition === "cloud") ?? artifacts[0];
  const meta = {
    version,
    url: `/apk/${encodeURIComponent(cloudArt.name)}`,
    size: cloudArt.size,
    note: "",
    force: false,
  };
  scp(writeMetaLocal(meta), `${APK_DIR}/desktop.json`);

  console.log(`✓ 发布完成: GET http://${host}:8787/api/app-version/desktop`);
} catch (e) {
  console.error("发布失败:", e.message);
  process.exit(1);
}

function writeMetaLocal(meta) {
  const tmp = join(releaseDir, ".desktop-meta.json");
  writeFileSync(tmp, JSON.stringify(meta, null, 2));
  return tmp;
}
