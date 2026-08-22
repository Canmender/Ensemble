import { Shield, ShieldAlert, ShieldCheck, Terminal, XCircle } from "lucide-react";
import { Badge, Button, Modal, cls } from "./ui";
import type { ToolConfirmRequest } from "../store/runs";

/** 根据工具名和参数推断风险等级 */
function getRiskLevel(tool: string, args: unknown): "low" | "medium" | "high" {
  if (tool === "execute_command") {
    const cmd = (args as { command?: string })?.command ?? "";
    const highRiskPatterns = [/rm\s+-rf/, /del\s+\/[sf]/, /format\s/, /mkfs/, /dd\s+if=/, /shutdown/, /reboot/, /reg\s+delete/];
    const medRiskPatterns = [/git\s+(push|reset|clean)/, /npm\s+(publish|uninstall)/, /pip\s+install/, /chmod/, /chown/, /sudo/];
    if (highRiskPatterns.some((p) => p.test(cmd))) return "high";
    if (medRiskPatterns.some((p) => p.test(cmd))) return "medium";
    return "low";
  }
  if (tool.includes("delete") || tool.includes("remove") || tool.includes("destroy")) return "high";
  if (tool.includes("write") || tool.includes("edit") || tool.includes("modify")) return "medium";
  return "low";
}

const riskConfig = {
  low: { label: "低风险", color: "green" as const, Icon: ShieldCheck },
  medium: { label: "中风险", color: "amber" as const, Icon: Shield },
  high: { label: "高风险", color: "red" as const, Icon: ShieldAlert },
};

export function ToolConfirmDialog({
  open,
  confirm,
  onApprove,
  onReject,
}: {
  open: boolean;
  confirm: ToolConfirmRequest | undefined;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (!confirm) return null;

  const risk = getRiskLevel(confirm.tool, confirm.args);
  const { label, color, Icon: RiskIcon } = riskConfig[risk];

  // 格式化参数显示
  const argsStr = (() => {
    try {
      const formatted = JSON.stringify(confirm.args ?? {}, null, 2);
      return formatted.length > 600 ? formatted.slice(0, 600) + "\n..." : formatted;
    } catch {
      return String(confirm.args);
    }
  })();

  return (
    <Modal open={open} onClose={onReject} title="工具执行确认">
      <div className="space-y-4">
        {/* 工具名称 + 风险等级 */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10">
            <Terminal className="h-5 w-5 text-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-fg truncate">{confirm.tool}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <RiskIcon className={cls("h-3.5 w-3.5", risk === "high" ? "text-destructive" : risk === "medium" ? "text-warning" : "text-success")} />
              <Badge color={color}>{label}</Badge>
            </div>
          </div>
        </div>

        {/* 命令/参数详情 */}
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">执行参数</div>
          <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-bg/60 p-3 text-[12px] leading-relaxed text-fg font-mono whitespace-pre-wrap break-all">
            {argsStr}
          </pre>
        </div>

        {/* 风险提示 */}
        {risk === "high" && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive leading-relaxed">
              此操作具有较高风险，可能导致不可逆的文件修改或系统变更。请仔细确认后再批准。
            </p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onReject}>
            拒绝
          </Button>
          <Button variant={risk === "high" ? "danger" : "primary"} onClick={onApprove}>
            批准执行
          </Button>
        </div>
      </div>
    </Modal>
  );
}
