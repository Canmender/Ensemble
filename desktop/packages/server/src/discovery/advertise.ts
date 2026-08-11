/**
 * mDNS 服务发布：向局域网广播 `_ensemble._tcp` 服务，
 * 供移动端 zeroconf 发现桌面端（IP / httpPort / wsPort）。
 */

import Bonjour from "bonjour-service";
import { hostname } from "node:os";
import { logger } from "../util/logger";

export interface AdvertiseOptions {
  httpPort: number;
  wsPort: number;
  deviceId: string;
  appVersion?: string;
}

/**
 * 发布合鸣服务。返回停止函数（应用退出时调用）。
 * 失败仅记录警告，不阻断启动。
 */
export function advertiseEnsembleService(opts: AdvertiseOptions): () => void {
  let bonjour: Bonjour | undefined;
  try {
    bonjour = new Bonjour();
    bonjour.publish({
      name: `合鸣-${hostname()}`,
      type: "ensemble", // → _ensemble._tcp.local
      port: opts.httpPort,
      txt: {
        deviceId: opts.deviceId,
        deviceType: "desktop",
        httpPort: String(opts.httpPort),
        wsPort: String(opts.wsPort),
        appVersion: opts.appVersion ?? "0.0.0",
        os: process.platform,
      },
    });
    logger.info(`mDNS: advertised _ensemble._tcp on port ${opts.httpPort}`);
  } catch (err) {
    logger.warn(`mDNS advertise failed: ${String(err)}`);
  }

  return () => {
    try {
      bonjour?.destroy();
    } catch {
      /* 忽略停止错误 */
    }
  };
}
