import type { AppSettings } from "@ensemble/shared";

/** 危险命令名（首词精确匹配，避免误判/漏判） */
const DANGEROUS_COMMANDS = new Set([
  "rm", "del", "erase", "rd", "rmdir", "format", "mkfs", "mkfs.ext4",
  "shutdown", "reboot", "halt", "poweroff", "taskkill", "reg", "format.com",
]);

/** 判断命令是否危险（解析首词命令名，忽略路径/扩展名） */
export function isDangerousCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  const firstWord = trimmed.split(/\s+/)[0] ?? "";
  const base = firstWord.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, "").split(/[\\/]/).pop() ?? "";
  return DANGEROUS_COMMANDS.has(base);
}

/** 检查命令是否被安全围栏允许，返回拒绝原因（null = 允许） */
export function checkCommandAllowed(command: string, security: AppSettings["security"]): string | null {
  if (!security) return null;

  if (security.blockedCommands?.length) {
    const blocked = security.blockedCommands.find((x) => x && command.includes(x));
    if (blocked) return `命令被安全围栏阻止（黑名单含: ${blocked}）`;
  }

  if (security.allowedCommands?.length) {
    const ok = security.allowedCommands.some((x) => x && command.trim().startsWith(x));
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
