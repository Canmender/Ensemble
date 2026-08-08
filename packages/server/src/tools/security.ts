import type { AppSettings } from "@jungle/shared";

/** 危险命令模式（allowDangerousCommands=false 时阻止） */
const DANGEROUS_RE =
  /(^|\s)(rm\s+-(rf|-r\s+-f)|del\s+\/s|rd\s+\/s|format\s+|mkfs|shutdown|reboot|taskkill\s+\/f\s+\/im|reg\s+delete)(\s|$)/i;

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

  if (security.allowDangerousCommands === false && DANGEROUS_RE.test(command)) {
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
