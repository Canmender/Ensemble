import type { AppSettings } from "@ensemble/shared";

/** 危险命令名（首词精确匹配，避免误判/漏判） */
const DANGEROUS_COMMANDS = new Set([
  "rm", "del", "erase", "rd", "rmdir", "format", "mkfs", "mkfs.ext4",
  "shutdown", "reboot", "halt", "poweroff", "taskkill", "reg", "format.com",
]);

/**
 * Shell 元字符：出现在命令字符串中即表示可能存在命令注入。
 * 允许在引号内的参数中出现（如 `echo "price is $5"` 中的 `$`），但完整的
 * 命令拼接符（&&、||、;、|）和子 shell 调用（`...`、$(...)）始终阻止。
 */
const SHELL_META_REGEX = /(?:\|\||&&|;|\||`|\$\()/;

/**
 * 从命令字符串中提取第一个 token（命令名），忽略环境变量赋值前缀
 * 如 `FOO=bar npm test` → `npm`；`NODE_ENV=prod node index.js` → `node`
 */
function extractFirstCommand(command: string): string {
  const tokens = command.trim().split(/\s+/);
  for (const tok of tokens) {
    // 跳过 VAR=value 形式的环境变量赋值
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue;
    return tok;
  }
  return "";
}

/** 判断命令是否危险（解析首词命令名，忽略路径/扩展名） */
export function isDangerousCommand(command: string): boolean {
  const firstWord = extractFirstCommand(command);
  if (!firstWord) return false;
  const base = firstWord.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, "").split(/[\\/]/).pop() ?? "";
  return DANGEROUS_COMMANDS.has(base);
}

/**
 * 检查命令是否包含危险的 shell 元字符（命令注入向量）。
 * 返回发现的元字符模式，null 表示安全。
 */
export function hasShellMetacharacters(command: string): string | null {
  const match = command.match(SHELL_META_REGEX);
  return match ? match[0] : null;
}

/**
 * 将用户配置的单词模式编译为单词边界正则。
 * 例如 "rm" → /(?<![.\w])rm(?!\w)/i，不会误匹配 "firmware" 中的 "rm"。
 */
function compileBlockedPattern(pattern: string): RegExp {
  // 转义特殊正则字符，然后包裹在单词边界中
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 使用 \b 作为简单的单词边界；对于包含路径分隔符等的模式，
  // 退回到子串匹配以保持兼容性
  if (/^[A-Za-z0-9_-]+$/.test(pattern)) {
    return new RegExp(`(?<![.\\w])${escaped}(?!\\w)`, "i");
  }
  // 含特殊字符的模式（如路径）退回到字面匹配
  return new RegExp(escaped, "i");
}

/** 检查命令是否被安全围栏允许，返回拒绝原因（null = 允许） */
export function checkCommandAllowed(command: string, security: AppSettings["security"]): string | null {
  if (!security) return null;

  // 1. 检查 shell 元字符（命令注入防护）
  const meta = hasShellMetacharacters(command);
  if (meta) {
    return `命令包含不允许的 shell 元字符: ${meta}`;
  }

  // 2. 黑名单检查：使用单词边界匹配，避免 "firmware" 被 "rm" 误拦
  if (security.blockedCommands?.length) {
    const blocked = security.blockedCommands.find((x) => {
      if (!x) return false;
      const re = compileBlockedPattern(x);
      return re.test(command);
    });
    if (blocked) return `命令被安全围栏阻止（黑名单含: ${blocked}）`;
  }

  // 3. 白名单检查：仅匹配第一个 token（命令名），不允许 "npm;rm -rf /" 绕过
  if (security.allowedCommands?.length) {
    const cmdName = extractFirstCommand(command);
    const ok = security.allowedCommands.some((x) => {
      if (!x) return false;
      const allowed = x.trim().toLowerCase();
      const actual = cmdName.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, "").split(/[\\/]/).pop() ?? "";
      return actual === allowed;
    });
    if (!ok) return "命令不在安全围栏白名单内";
  }

  // 危险命令默认禁止（allowDangerousCommands !== true 即禁止，与 UI 默认一致）
  if (security.allowDangerousCommands !== true && isDangerousCommand(command)) {
    return "危险命令被安全围栏阻止";
  }

  return null;
}

/** 检查文件读是否允许 */
export function checkFileReadAllowed(security: AppSettings["security"]): string | null {
  if (security && security.allowFileRead === false) return "安全围栏：文件读取已禁用";
  return null;
}

/** 检查文件写是否允许 */
export function checkFileWriteAllowed(security: AppSettings["security"]): string | null {
  if (security && security.allowFileWrite === false) return "安全围栏：文件写入已禁用";
  return null;
}

/** 检查网络是否允许 */
export function checkNetworkAllowed(security: AppSettings["security"]): string | null {
  if (security && security.allowNetwork === false) return "安全围栏：网络访问已禁用";
  return null;
}
