/**
 * 设计 Token 消费层（RN 侧）
 *
 * 单源：desktop/packages/shared/design/tokens.json（W3C Design Tokens Format，
 * primitive OKLCH/hex + semantic light/dark + spring 物理参数）。
 * RN 不支持 oklch() 字符串，这里在运行时做一次性解析：OKLCH → sRGB hex。
 *
 * 移动端当前消费 semantic.light（浅色主题）；暗色主题接入时按 colorScheme 切换
 * tokens.semantic.dark 即可，值永远与桌面端同源。
 */
import tokens from "../../../desktop/packages/shared/design/tokens.json";

// ─── W3C token 最小解析器 ────────────────────────────────────────

/** token 节点：{$value} 为 token，否则是 group；个别位置可能是裸字符串（容错） */
type TokenNode = { $type?: string; $value: unknown } | { [k: string]: TokenNode } | string;

function resolve(node: unknown): unknown {
  if (typeof node === "string") return node;
  const n = node as TokenNode;
  if (n && typeof n === "object" && "$value" in n) return n.$value;
  return node;
}

/** 取路径值：get(tokens, ["primitive","spring","universal"]) → {$value:{...}} 的 value */
function get(path: string[]): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = tokens;
  for (const seg of path) cur = cur?.[seg];
  return resolve(cur);
}

/** 别名引用解引用："{semantic.light.bg}" → 颜色字符串 */
function deref(value: unknown): unknown {
  if (typeof value === "string") {
    const m = /^\{(.+)\}$/.exec(value);
    if (m) {
      const target = get(m[1].split("."));
      // 目标可能仍是别名（链式），递归一层足够（本仓库无三级链）
      return deref(target);
    }
  }
  return value;
}

// ─── OKLCH → sRGB hex（移动端构建/运行时转换；公式见 Evil Martians 文章） ──

function oklchToHex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  const a = Math.cos(h) * C;
  const b = Math.sin(h) * C;
  // OKLab → LMS'（非线性）→ LMS（线性）
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  // LMS（线性）→ linear sRGB
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  // gamma 编码 + clamp + 量化
  const enc = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(255, Math.max(0, v * 255)));
  };
  const to2 = (x: number) => enc(x).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(bl)}`;
}

/** 颜色值归一化为 RN 可用的 #RRGGBB：hex 直通；oklch(...) 转换 */
export function tokenColor(raw: unknown): string {
  const v = String(deref(raw));
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(v);
  if (m) return oklchToHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return v; // 已是 hex/rgba
}

// ─── 导出语义层（light 主题起步） ───────────────────────────────

const semanticLight = (tokens as { semantic: { light: Record<string, unknown> } }).semantic.light;

/** 浅色主题语义色板（与桌面端 CSS vars 同源同名，kebab → camel） */
export const palette = {
  bg: tokenColor(semanticLight.bg),
  surface: tokenColor(semanticLight.surface),
  surfaceAlt: tokenColor(semanticLight.surface1),
  surfaceHigh: tokenColor(semanticLight.surface2),
  border: tokenColor(semanticLight.border),
  text: tokenColor(semanticLight.fg),
  textMuted: tokenColor(semanticLight.muted),
  primary: tokenColor(semanticLight.primary),
  onPrimary: tokenColor(semanticLight["primary-fg"]),
  accent: tokenColor(semanticLight.accent),
  destructive: tokenColor(semanticLight.destructive),
  ring: tokenColor(semanticLight.ring),
} as const;

/** 弹簧物理参数（与 utils/motion.ts 常量同源；此处为 token 权威源） */
export const springs = get(["primitive", "spring"]) as Record<
  string,
  { damping: number; stiffness: number }
>;

export default tokens;
