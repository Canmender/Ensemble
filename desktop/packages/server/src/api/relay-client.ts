/**
 * 云端中继客户端
 *
 * 让桌面端通过中继服务器与移动端通信
 * 支持跨网络连接
 */

import { io, Socket } from "socket.io-client";
import { logger } from "../util/logger";

export interface RelayConfig {
  /** 中继服务器地址 */
  url: string;
  /** 设备 ID */
  deviceId: string;
  /** 设备名称 */
  deviceName: string;
  /** 认证 token（可选） */
  token?: string;
}

export interface RelayMessage {
  id: string;
  from: string;
  fromName: string;
  to: string;
  type: string;
  payload: any;
  timestamp: number;
}

export type MessageHandler = (message: RelayMessage) => void;

export class RelayClient {
  private socket: Socket | null = null;
  private config: RelayConfig | null = null;
  private messageHandlers: MessageHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  /** 用户主动断开：true 时不再任何自动重连 */
  private userDisconnected = false;
  /** 自愈重连：内建重连耗尽（reconnect_failed）后接管，长期断网恢复后自动回线上 */
  private selfHealTimer: ReturnType<typeof setTimeout> | null = null;
  private selfHealAttempt = 0;

  /** 配置中继客户端 */
  configure(config: RelayConfig): void {
    this.config = config;
    logger.info(`[Relay] 配置中继服务器: ${config.url}`);
  }

  /** 连接到中继服务器 */
  async connect(): Promise<boolean> {
    if (!this.config) {
      logger.error("[Relay] 未配置中继服务器");
      return false;
    }

    this.userDisconnected = false;
    this.cancelSelfHeal();
    // 无条件清理旧 socket：包括已断开但仍在后台自动重连的实例，避免双 socket 竞争
    this.destroySocket();

    logger.info(`[Relay] 连接到中继服务器: ${this.config.url}`);

    try {
      this.socket = io(this.config.url, {
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 15000,
        auth: this.config.token ? { token: this.config.token } : undefined,
      });

      this.setupListeners();

      // 等待连接建立
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 15000);

        this.socket!.once("connect", () => {
          clearTimeout(timeout);
          resolve(true);
        });

        this.socket!.once("connect_error", (err) => {
          clearTimeout(timeout);
          logger.error(`[Relay] 连接失败: ${err.message}`);
          resolve(false);
        });
      });
    } catch (error) {
      logger.error(`[Relay] 连接异常: ${error}`);
      return false;
    }
  }

  /** 断开连接（用户主动）：停止一切自动重连 */
  disconnect(): void {
    this.userDisconnected = true;
    this.cancelSelfHeal();
    this.destroySocket();
    logger.info("[Relay] 已断开连接");
  }

  /** 销毁当前 socket 与监听器 */
  private destroySocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.reconnectAttempts = 0;
  }

  private cancelSelfHeal(): void {
    if (this.selfHealTimer) {
      clearTimeout(this.selfHealTimer);
      this.selfHealTimer = null;
    }
  }

  /** 自愈重连：指数递增间隔（30s 起步，封顶 5 分钟），成功后由 connect 事件归零 */
  private scheduleSelfHeal(): void {
    if (this.userDisconnected || !this.config) return;
    this.cancelSelfHeal();
    this.selfHealAttempt += 1;
    const delaySec = Math.min(30 * this.selfHealAttempt, 300);
    logger.info(`[Relay] 自愈重连：${delaySec}s 后第 ${this.selfHealAttempt} 次尝试`);
    this.selfHealTimer = setTimeout(() => {
      this.selfHealTimer = null;
      void this.connect();
    }, delaySec * 1000);
  }

  /** 发送消息到指定设备 */
  sendToDevice(targetDeviceId: string, type: string, payload: any): void {
    if (!this.socket?.connected) {
      logger.warn("[Relay] 未连接，无法发送消息");
      return;
    }

    this.socket.emit("message", {
      to: targetDeviceId,
      type,
      payload,
    });

    logger.debug(`[Relay] 发送消息到 ${targetDeviceId}: ${type}`);
  }

  /** 广播消息到所有设备 */
  broadcast(type: string, payload: any): void {
    if (!this.socket?.connected) {
      logger.warn("[Relay] 未连接，无法发送消息");
      return;
    }

    this.socket.emit("message", {
      to: "*",
      type,
      payload,
    });

    logger.debug(`[Relay] 广播消息: ${type}`);
  }

  /** 注册消息处理器 */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /** 移除消息处理器 */
  offMessage(handler: MessageHandler): void {
    this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /** 获取连接状态 */
  getStatus(): "disconnected" | "connecting" | "connected" {
    if (!this.socket) return "disconnected";
    if (this.socket.connected) return "connected";
    return "connecting";
  }

  /** 设置监听器 */
  private setupListeners(): void {
    if (!this.socket) return;

    // 连接成功
    this.socket.on("connect", () => {
      logger.info("[Relay] 已连接到中继服务器");
      this.reconnectAttempts = 0;
      this.selfHealAttempt = 0;

      // 注册设备
      this.registerDevice();
    });

    // 连接断开
    this.socket.on("disconnect", (reason) => {
      logger.warn(`[Relay] 连接断开: ${reason}`);
      // 服务端主动踢下线时 socket.io 不会自动重连，这里手动恢复
      if (reason === "io server disconnect" && !this.userDisconnected) {
        logger.info("[Relay] 服务端断开，尝试重新连接");
        this.socket?.connect();
      }
    });

    // 重连尝试
    this.socket.on("reconnect_attempt", (attempt) => {
      this.reconnectAttempts = attempt;
      logger.info(`[Relay] 重连尝试 ${attempt}/${this.maxReconnectAttempts}`);
    });

    // 重连失败（内建重连耗尽）→ 转入自愈模式，长期断网恢复后自动回线上
    this.socket.on("reconnect_failed", () => {
      logger.error("[Relay] 内建重连耗尽，转入自愈模式");
      this.scheduleSelfHeal();
    });

    // 设备注册成功
    this.socket.on("device:registered", (data: any) => {
      logger.info(`[Relay] 设备注册成功: ${data.deviceId}`);
    });

    // 收到设备列表
    this.socket.on("device:list", (data: { devices: any[] }) => {
      logger.info(`[Relay] 在线设备: ${data.devices.length} 个`);
    });

    // 设备上线
    this.socket.on("device:online", (device: any) => {
      logger.info(`[Relay] 设备上线: ${device.name} (${device.type})`);
    });

    // 设备离线
    this.socket.on("device:offline", (data: { deviceId: string; name?: string }) => {
      logger.info(`[Relay] 设备离线: ${data.name || data.deviceId}`);
    });

    // 收到消息
    this.socket.on("message", (message: RelayMessage) => {
      logger.debug(`[Relay] 收到消息: ${message.type} from ${message.fromName}`);
      this.handleMessage(message);
    });

    // 消息已暂存
    this.socket.on("message:queued", (data: any) => {
      logger.info(`[Relay] 消息已暂存: ${data.message}`);
    });

    // 错误
    this.socket.on("error", (err: any) => {
      logger.error(`[Relay] 错误: ${err.message || err}`);
    });
  }

  /** 注册设备 */
  private registerDevice(): void {
    if (!this.socket || !this.config) return;

    this.socket.emit("device:register", {
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      deviceType: "desktop",
    });
  }

  /** 处理收到的消息 */
  private handleMessage(message: RelayMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        logger.error(`[Relay] 消息处理错误: ${error}`);
      }
    }
  }
}

// 导出单例
export const relayClient = new RelayClient();
