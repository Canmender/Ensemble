/**
 * 重连补拉：WS 断线重连成功后的全局增量同步。
 *
 * 服务端事件先落库再广播（WsEnvelope.seq 单调递增），断线窗口内错过的
 * 状态变化通过 HTTP 补拉端点找回（标准次序：增量拉取 → 原子合并 → 恢复订阅）。
 * 聊天历史的按 seq 补拉待服务端 chat_messages.seq 迁移后接入（见 docs/技术调研）。
 */
import { wsLink } from "./wslink";
import { api } from "./api";
import { useTaskStore } from "../store/taskStore";

let bootstrapped = false;

/** App 登录后调用一次：注册全局重连补拉动作 */
export function bootstrapResync(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  wsLink.onResync(() => {
    // 活跃 run 状态兜底刷新：断线期间结束/出错的 run 本地状态会停留在旧值
    void (async () => {
      try {
        const { runs, updateRun } = useTaskStore.getState();
        const active = runs.filter((r) => r.status === "running" || r.status === "queued");
        if (active.length === 0) return;
        const fresh = await Promise.all(active.map((r) => api.getRun(r.id).catch(() => null)));
        for (const res of fresh) {
          if (res?.data) {
            updateRun(res.data.id, {
              status: res.data.status,
              finalResult: res.data.finalResult,
              error: res.data.error,
            });
          }
        }
      } catch {
        /* 补拉失败静默：等下次重连或页面焦点刷新兜底 */
      }
    })();
  });
}
