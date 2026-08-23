/**
 * 服务生命周期插件（实施手册 R2⑤⑥ 思想，载体为自研内核）：
 * - 维护定时器 effect 化：注册即启动，宿主卸载自动清理（不再手动 clearInterval）
 * - 后续新增常驻服务（缓存预热、索引构建等）都应挂成插件，dispose 由内核统一接管
 */
import type { EnsemblePlugin } from "./kernel";
import { logger } from "../util/logger";

export interface MaintenanceDeps {
  /** 每日维护体（记忆 consolidate/轮转 + offload 清理 + 记忆池过期清理） */
  runMaintenance: () => Promise<void>;
  intervalMs?: number;
}

/** 每日维护定时器插件（原 context.ts 手动 setInterval + clearInterval 的 effect 化替身） */
export function maintenancePlugin(deps: MaintenanceDeps): EnsemblePlugin {
  return {
    name: "maintenance-timer",
    install: (ctx) => {
      const intervalMs = deps.intervalMs ?? 24 * 3600_000;
      ctx.effect(() => {
        const timer = setInterval(() => {
          void deps.runMaintenance().catch((err) =>
            logger.error(`maintenance timer error: ${String(err)}`),
          );
        }, intervalMs);
        timer.unref?.();
        logger.info(`maintenance timer scheduled (${Math.round(intervalMs / 3600000)}h)`);
        return () => {
          clearInterval(timer);
          logger.info("maintenance timer cleared");
        };
      }, "maintenance-interval");
    },
  };
}
