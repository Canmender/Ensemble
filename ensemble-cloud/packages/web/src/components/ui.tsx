import React, { useEffect } from "react";
import { Search } from "lucide-react";

export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------- Button ----------
type BtnVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const styles: Record<BtnVariant, string> = {
    primary:
      "bg-primary text-primary-fg hover:bg-primary/90 shadow-sm shadow-primary/20 disabled:opacity-50",
    secondary: "bg-surface text-fg border border-border hover:border-primary/60 hover:text-primary",
    ghost: "text-muted hover:bg-muted/10 hover:text-fg",
    danger: "bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20",
  };
  return (
    <button
      className={cls(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

// ---------- Badge ----------
export function Badge({
  children,
  color = "ink",
}: {
  children: React.ReactNode;
  color?: "ink" | "brand" | "green" | "amber" | "red" | "violet";
}) {
  const map = {
    ink: "bg-muted/10 text-fg",
    brand: "bg-primary/10 text-primary",
    green: "bg-success/10 text-success",
    amber: "bg-warning/10 text-warning",
    red: "bg-destructive/10 text-destructive",
    violet: "bg-primary/15 text-primary",
  };
  return (
    <span className={cls("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", map[color])}>
      {children}
    </span>
  );
}

// ---------- StatusDot ----------
const STATUS_COLOR: Record<string, string> = {
  queued: "bg-muted/50",
  starting: "bg-warning animate-pulse",
  running: "bg-primary animate-pulse",
  thinking: "bg-primary/70 animate-pulse",
  success: "bg-success",
  error: "bg-destructive",
  cancelled: "bg-muted/70",
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cls("inline-block h-2 w-2 rounded-full", STATUS_COLOR[status] ?? "bg-muted/50")}
      aria-label={statusLabel(status)}
      role="img"
    />
  );
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: "排队中",
    starting: "启动",
    running: "运行中",
    thinking: "思考中",
    success: "成功",
    error: "失败",
    cancelled: "已取消",
  };
  return map[status] ?? status;
}

// ---------- Card ----------
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cls("rounded-xl border border-border bg-surface shadow-sm", className)}>{children}</div>
  );
}

// ---------- Input / Textarea / Select ----------
const fieldCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/70 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={fieldCls} {...props} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cls(fieldCls, "min-h-[90px] font-mono text-[13px] leading-relaxed")} {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={fieldCls} {...props} />;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-semibold text-muted">{children}</label>;
}

// ---------- Spinner ----------
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in anim-dur-200"
        onClick={onClose}
      />
      <div
        className={cls(
          "relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl",
          "animate-in fade-in zoom-in-95 anim-dur-200",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1 text-muted hover:bg-muted/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ---------- EmptyState ----------
export function EmptyState({
  icon,
  title,
  desc,
}: {
  icon?: React.ReactNode;
  title: string;
  desc?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="mb-3 text-muted">{icon ?? <Search className="h-8 w-8" />}</div>
      <div className="text-sm font-medium text-fg">{title}</div>
      {desc && <div className="mt-1 max-w-sm text-xs text-muted">{desc}</div>}
    </div>
  );
}

// ---------- ConfirmDialog ----------
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "确认",
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-6 text-sm text-muted">{message}</p>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ---------- Toast (简易版) ----------
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string, type: "success" | "error" = "success") {
  // 移除已有 toast
  document.querySelectorAll(".ensemble-toast").forEach((el) => el.remove());

  const toast = document.createElement("div");
  toast.className = "ensemble-toast";
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    padding: 12px 20px; border-radius: 12px;
    font-size: 14px; font-weight: 500;
    animation: fadeIn 0.2s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    ${type === "success"
      ? "background: #10b981; color: white;"
      : "background: #ef4444; color: white;"
    }
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
