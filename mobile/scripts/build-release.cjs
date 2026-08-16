/**
 * 发布构建辅助：确保 android/app/build.gradle 的版本号从 app.json 读取，
 * 然后执行 assembleRelease 产出 APK。
 *
 * 背景：mobile/android 是 git-ignored 的 expo prebuild 产物。若 prebuild 重新生成，
 * build.gradle 会把版本号硬编码为当时的旧值，导致 APK 版本错乱
 * （曾出现安装界面显示旧版本、versionCode 不递增的问题）。
 * 本脚本让 app.json 成为唯一版本源（expo.version / expo.android.versionCode）。
 *
 * 用法：node scripts/build-release.cjs [--skip-build]
 */
const { execSync } = require("child_process");
const { readFileSync, writeFileSync, existsSync } = require("fs");
const { join } = require("path");

const root = join(__dirname, "..");
const appJson = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
const expo = appJson.expo || appJson;
const version = expo.version || "0.0.0";
const versionCode = (expo.android && expo.android.versionCode) || expo.versionCode || 1;
console.log("目标版本: " + version + " (versionCode " + versionCode + ")");

const gradle = join(root, "android", "app", "build.gradle");
if (!existsSync(gradle)) {
  console.error("未找到 " + gradle + " —— 请先 expo prebuild / expo run:android 生成 android 目录");
  process.exit(1);
}

let text = readFileSync(gradle, "utf8");
const MARK = "// 版本号从 app.json 读取（单一版本源）";
const block =
  "    // 版本号从 app.json 读取（单一版本源）\n" +
  "    def _appJsonPath = new File(projectRoot, \"app.json\").getAbsolutePath()\n" +
  "    def _dv = [\n" +
  "      \"node\", \"-e\",\n" +
  "      \"const{readFileSync}=require('fs');const a=JSON.parse(readFileSync(process.argv[1],'utf8'));const e=a.expo||a;process.stdout.write(String(e.android&&e.android.versionCode?''+e.android.versionCode:''));\",\n" +
  "      _appJsonPath\n" +
  "    ].execute(null, rootDir).text.trim()\n" +
  "    def _vn = [\n" +
  "      \"node\", \"-e\",\n" +
  "      \"const{readFileSync}=require('fs');const a=JSON.parse(readFileSync(process.argv[1],'utf8'));const e=a.expo||a;process.stdout.write(String(e.version||'0.0.0'));\",\n" +
  "      _appJsonPath\n" +
  "    ].execute(null, rootDir).text.trim()\n" +
  "    versionCode new Integer(_dv ?: 1)\n" +
  "    versionName new String(_vn ?: \"0.0.0\")\n";

if (!text.includes(MARK)) {
  // 移除 defaultConfig 内已有的硬编码 versionCode/versionName，替换为读取块
  const re = /(\s*versionCode\s+[^\n]*\n)(\s*versionName\s+"[^"]*"\n)/;
  if (re.test(text)) {
    text = text.replace(re, block);
  } else {
    // 找不到成对行时，兜底：在 applicationId 行后插入读取块
    text = text.replace(/(\s*applicationId\s+'[^']+'\n)/, "$1" + block);
  }
  writeFileSync(gradle, text, "utf8");
  console.log("build.gradle 已注入 app.json 版本读取逻辑");
} else {
  console.log("build.gradle 已包含版本读取逻辑（跳过注入）");
}

if (process.argv.includes("--skip-build")) {
  console.log("跳过构建（--skip-build）");
  process.exit(0);
}

console.log("开始构建 assembleRelease …");
execSync(join(root, "android", "gradlew.bat") + " assembleRelease", {
  cwd: join(root, "android"),
  stdio: "inherit",
});
console.log("构建完成: android/app/build/outputs/apk/release/app-release.apk");