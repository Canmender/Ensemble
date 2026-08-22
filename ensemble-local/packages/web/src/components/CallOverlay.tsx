import { Phone, PhoneOff, X } from "lucide-react";
import { useCallStore } from "../lib/callStore";
import { acceptCall, rejectCall, hangup } from "../lib/callService";

/** 通话全屏层：呼入/呼叫中/通话中/结束（由 callStore 驱动） */
export function CallOverlay() {
  const { phase, direction, peer, reason } = useCallStore();
  if (phase === "idle") return null;

  const name = peer?.name || peer?.userId || "对方";
  const isIncoming = direction === "incoming";

  const title =
    phase === "calling" || phase === "ringing" ? (isIncoming ? "来电" : "正在呼叫…")
    : phase === "connecting" ? "正在连接…"
    : phase === "in-call" ? "通话中" : "通话结束";
  const subtitle =
    phase === "calling" || phase === "ringing" ? (isIncoming ? "来自 " + name : "等待对方接听")
    : phase === "connecting" ? "建立音频通道"
    : phase === "ended" ? (reason || "") : "语音通话";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[rgba(15,18,25,0.96)]">
      <div className="mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-primary/20 text-4xl font-bold text-white">
        {name[0]?.toUpperCase()}
      </div>
      <div className="text-2xl font-bold text-white">{name}</div>
      <div className="mt-2 text-muted">{title} · {subtitle}</div>

      <div className="mt-10 flex items-center gap-6">
        {isIncoming && phase === "ringing" ? (
          <>
            <button onClick={rejectCall} className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-full bg-destructive text-white hover:bg-destructive/80">
              <X className="h-6 w-6" />
              <span className="text-xs">拒接</span>
            </button>
            <button onClick={() => void acceptCall()} className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-full bg-success text-white hover:bg-success/80">
              <Phone className="h-6 w-6" />
              <span className="text-xs">接听</span>
            </button>
          </>
        ) : phase === "in-call" || phase === "calling" || phase === "ringing" || phase === "connecting" ? (
          <button onClick={hangup} className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-full bg-destructive text-white hover:bg-destructive/80">
            <PhoneOff className="h-6 w-6" />
            <span className="text-xs">挂断</span>
          </button>
        ) : (
          <button onClick={() => useCallStore.getState().reset()} className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-full bg-white/15 text-white hover:bg-white/25">
            <X className="h-6 w-6" />
            <span className="text-xs">关闭</span>
          </button>
        )}
      </div>
    </div>
  );
}
