import { useCallback, useState } from "react";
import { ConfirmDialog } from "../components/ui";

/** Shared confirm-dialog hook. Returns a `confirm()` promise and a `<Dialog />` element. */
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    danger: boolean;
    onConfirm: () => void;
  }>({ open: false, title: "", message: "", confirmLabel: "确认", danger: false, onConfirm: () => {} });

  const confirm = useCallback(
    (opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => {
        setState({
          open: true,
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? "确认",
          danger: opts.danger ?? false,
          onConfirm: () => resolve(true),
        });
      }),
    [],
  );

  const Dialog = (
    <ConfirmDialog
      open={state.open}
      onClose={() => setState((s) => ({ ...s, open: false }))}
      onConfirm={state.onConfirm}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      danger={state.danger}
    />
  );

  return { confirm, Dialog };
}
