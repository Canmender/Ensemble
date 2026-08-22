/**
 * 设计 token 构建脚本：shared/design/tokens.json → 双端产物。
 * - web:  shared/design/generated/tokens.css   （--c-* RGB 三元组，兼容 tailwind.config 的 rgb(var(--c-x) / <alpha>) 映射）
 * - RN:   mobile/src/design/generated/tokens.ts （hex 常量 + 主题对象；RN 不支持 CSS vars）
 *
 * 用法：node scripts/build-tokens.mjs （在 desktop/ 目录或任意位置均可运行）
 * 单源改动后重跑即可，两端产物同源一致。OKLCH 迁移时只需把 $value 换成 oklch() 并在此处加转换。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "packages/shared/design/tokens.json"), "utf8"));

/** 解析花括号别名引用 "{primitive.color.slate.900}" → hex */
function resolveRef(ref, stack = new Set()) {
  const path = ref.startsWith("{") ? ref.slice(1, -1) : ref;
  if (stack.has(path)) throw new Error(`token 循环引用: ${path}`);
  const value = path.split(".").reduce((node, key) => node?.[key], tokens);
  if (!value?.$value) throw new Error(`引用不存在: ${path}`);
  if (typeof value.$value === "string" && value.$value.startsWith("{")) {
    return resolveRef(value.$value, stack.add(path));
  }
  return value.$value;
}

function hexToRgbTriplet(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const semantic = tokens.semantic;
const names = Object.keys(semantic.light);

/** semantic 条目 → 别名引用字符串（兼容 {$value} 规范形态与历史裸字符串） */
function semRef(entry) {
  const raw = typeof entry === "string" ? entry : entry?.$value;
  if (!raw) throw new Error(`semantic token 缺 $value`);
  return resolveRef(raw);
}

// ---------- web CSS ----------
const cssBlock = (theme) =>
  names.map((name) => `  --c-${name}: ${hexToRgbTriplet(semRef(semantic[theme][name]))};`).join("\n");
const css = `/* 由 scripts/build-tokens.mjs 从 design/tokens.json 自动生成 —— 手改无效 */
:root {
${cssBlock("light")}
  color-scheme: light;
}

.dark {
${cssBlock("dark")}
  color-scheme: dark;
}
`;
mkdirSync(join(root, "packages/shared/design/generated"), { recursive: true });
writeFileSync(join(root, "packages/shared/design/generated/tokens.css"), css);
console.log(`✓ web  → packages/shared/design/generated/tokens.css (${names.length} × 2 主题)`);

// ---------- RN TS ----------
const tsObject = (theme) =>
  names.map((name) => {
    const hex = semRef(semantic[theme][name]);
    return `  ${name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}: "${hex}",`;
  }).join("\n");
const springEntries = Object.entries(tokens.primitive.spring)
  .filter(([k, v]) => !k.startsWith("$") && v?.damping != null)
  .map(([k, v]) => `  ${k}: { damping: ${v.damping}, stiffness: ${v.stiffness} },`)
  .join("\n");
const camelNames = names.map((n) => n.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
const ts = `// 由 desktop/scripts/build-tokens.mjs 从 design/tokens.json 自动生成 —— 手改无效
export interface EnsembleTheme {
${camelNames.map((n) => `  ${n}: string;`).join("\n")}
}

export const LightTheme: EnsembleTheme = {
${tsObject("light")}
};

export const DarkTheme: EnsembleTheme = {
${tsObject("dark")}
};

/** 弹簧动画参数（damping/stiffness），与 web 端 CSS 曲线近似对应 */
export const springs = {
${springEntries}
} as const;
`;
// 输出到移动端仓库目录。desktop 的上一级即仓库根（主 checkout 与 .claude/worktrees/* 均成立）；
// 目录不存在（如独立检出 desktop）时报错并提示，不静默。
const mobileDir = resolve(root, "../mobile/src/design/generated");
try {
  mkdirSync(mobileDir, { recursive: true });
  writeFileSync(join(mobileDir, "tokens.ts"), ts);
  console.log(`✓ RN   → mobile/src/design/generated/tokens.ts`);
} catch (e) {
  console.warn(`! RN   → mobile 目录写入失败（${mobileDir}）：${e.message}`);
}
