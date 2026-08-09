/**
 * 连接服务
 * 管理与桌面端的 WebSocket 连接
 *
 * 支持两种连接模式：
 * 1. 局域网直连 — 直接连接桌面端 IP
 * 2. 云端中继 — 通过阿里云服务器中继
 */

import { io, Socket } from "socket.io-client";
import type {
  DeviceInfo,
  EnsembleMessage,
  ConnectionState,
} from "@ensemble/shared-protocol";
import { createMessage, isValidMessage } from "@ensemble/shared-protocol";
import { useDeviceStore } from "../store/deviceStore";
import { useTaskStore } from "../store/taskStore";

/** 连接模式 */
export type ConnectionMode = "lan" | "relay";

/** 云端中继服务器配置 */
interface RelayConfig {
  /** 中继服务器地址 */
  url: string;
  /** 认证 token（可选） */
  token?: string;
}

class ConnectionService {
  private socket: Socket | null = null;
  private currentDeviceId: string | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private connectionMode: ConnectionMode = "lan";
  private relayConfig: RelayConfig | null = null;

  /** 初始化当前设备信息 */
  async init(): Promise<void> {
    // 生成或读取设备 ID
    this.currentDeviceId = await this.getOrCreateDeviceId();

    // 设置当前设备信息
    const deviceInfo: DeviceInfo = {
      id: this.currentDeviceId,
      name: await this.getDeviceName(),
      type: "mobile",
      os: "React Native",
      appVersion: "0.1.0",
      wsPort: 0,
      httpPort: 0,
      ip: "0.0.0.0",
      lastSeen: Date.now(),
    };

    useDeviceStore.getState().setCurrentDevice(deviceInfo);
  }

  /** 配置云端中继服务器 */
  setRelayConfig(config: RelayConfig): void {
    this.relayConfig = config;
  }

  /** 连接到桌面端（局域网直连） */
  async connect(ip: string, port: number): Promise<boolean> {
    this.connectionMode = "lan";
    return this.connectToServer(`http://${ip}:${port}`);
  }

  /** 连接到云端中继服务器 */
  async connectViaRelay(relayUrl?: string): Promise<boolean> {
    this.connectionMode = "relay";
    const url = relayUrl || this.relayConfig?.url;

    if (!url) {
      useDeviceStore.getState().setError("未配置中继服务器地址");
      return false;
    }

    return this.connectToServer(url);
  }

  /** 底层连接实现 */
  private async connectToServer(url: string): Promise<boolean> {
    if (this.socket?.connected) {
      this.disconnect();
    }

    useDeviceStore.getState().setConnectionState("connecting");
    useDeviceStore.getState().setError(null);

    try {
      this.socket = io(url, {
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        auth: this.relayConfig?.token ? { token: this.relayConfig.token } : undefined,
      });

      this.setupSocketListeners();

      // 等待连接建立
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 10000);

        this.socket!.once("connect", () => {
          clearTimeout(timeout);
          resolve(true);
        });

        this.socket!.once("connect_error", () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });
    } catch (error) {
      useDeviceStore.getState().setConnectionState("error");
      useDeviceStore.getState().setError(
        error instanceof Error ? error.message : "连接失败"
      );
      return false;
    }
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    useDeviceStore.getState().setConnectionState("disconnected");
    useDeviceStore.getState().setConnectedDevice(null);
    this.reconnectAttempts = 0;
  }

  /** 发送消息到指定设备 */
  sendToDevice(targetDeviceId: string, type: string, payload: unknown): void {
    if (!this.socket?.connected || !this.currentDeviceId) {
      console.warn("未连接，无法发送消息");
      return;
    }

    if (this.connectionMode === "relay") {
      // 云端中继模式：通过服务器转发
      this.socket.emit("message", {
        to: targetDeviceId,
        type,
        payload,
      });
    } else {
      // 局域网直连模式：直接发送
      const message = createMessage(
        type as any,
        this.currentDeviceId,
        targetDeviceId,
        payload as any
      );
      this.socket.emit("message", message);
    }
  }

  /** 广播消息到所有设备 */
  broadcast(type: string, payload: unknown): void {
    if (!this.socket?.connected || !this.currentDeviceId) {
      console.warn("未连接，无法发送消息");
      return;
    }

    if (this.connectionMode === "relay") {
      // 云端中继模式：广播
      this.socket.emit("message", {
        to: "*",
        type,
        payload,
      });
    } else {
      // 局域网直连模式
      const message = createMessage(
        type as any,
        this.currentDeviceId,
        null,
        payload as any
      );
      this.socket.emit("message", message);
    }
  }

  /** 创建任务 */
  createTask(title: string, mode: "single" | "workflow" | "chat", input: unknown): void {
    this.broadcast("task:create", { title, mode, input });
  }

  /** 发送聊天消息 */
  sendChatMessage(runId: string, content: string): void {
    this.broadcast("chat:send", { runId, content });
  }

  /** 发送控制命令 */
  sendControlCommand(
    command: "pause" | "resume" | "cancel" | "retry",
    targetId: string,
    targetType: "task" | "run" | "job"
  ): void {
    this.broadcast("control:command", { command, targetId, targetType });
  }

  /** 请求状态同步 */
  requestSync(since?: number): void {
    this.broadcast("sync:request", {
      types: ["agents", "tasks", "runs", "jobs"],
      since,
    });
  }

  /** 获取连接模式 */
  getConnectionMode(): ConnectionMode {
    return this.connectionMode;
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /** 设置 Socket 监听器 */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    // 连接成功
    this.socket.on("connect", () => {
      console.log("已连接到桌面端");
      useDeviceStore.getState().setConnectionState("connected");
      this.reconnectAttempts = 0;

      // 发送设备信息
      this.sendDeviceOnline();

      // 请求同步
      this.requestSync();

      // 启动心跳
      this.startPing();
    });

    // 连接断开
    this.socket.on("disconnect", (reason) => {
      console.log("连接断开:", reason);
      useDeviceStore.getState().setConnectionState("disconnected");
      useDeviceStore.getState().setConnectedDevice(null);

      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
    });

    // 重连尝试
    this.socket.on("reconnect_attempt", (attempt) => {
      this.reconnectAttempts = attempt;
      useDeviceStore.getState().setConnectionState("reconnecting");
    });

    // 重连失败
    this.socket.on("reconnect_failed", () => {
      useDeviceStore.getState().setConnectionState("error");
      useDeviceStore.getState().setError("重连失败，请检查网络连接");
    });

    // 接收消息
    this.socket.on("message", (data: unknown) => {
      if (isValidMessage(data)) {
        this.handleMessage(data);
      }
    });

    // Socket.IO 特定事件
    this.socket.on("device:online", (device: DeviceInfo) => {
      if (device.type === "desktop") {
        useDeviceStore.getState().setConnectedDevice(device);
      }
    });

    this.socket.on("device:offline", ({ deviceId }: { deviceId: string }) => {
      const connected = useDeviceStore.getState().connectedDevice;
      if (connected?.id === deviceId) {
        useDeviceStore.getState().setConnectedDevice(null);
      }
    });
  }

  /** 处理接收到的消息 */
  private handleMessage(message: EnsembleMessage): void {
    const taskStore = useTaskStore.getState();

    switch (message.type) {
      case "task:create:response":
        taskStore.addTask(message.payload.task);
        if (message.payload.run) {
          taskStore.addRun(message.payload.run);
        }
        break;

      case "task:status":
        taskStore.updateRun(message.payload.runId, {
          status: message.payload.status as any,
        });
        message.payload.jobs.forEach((job) => {
          taskStore.updateJob(job.id, job);
        });
        break;

      case "agent:event":
        taskStore.updateJob(message.payload.jobId, {
          events: [
            ...(taskStore.jobs.find((j) => j.id === message.payload.jobId)?.events || []),
            message.payload.event,
          ],
        });
        break;

      case "chat:message":
        // 聊天消息已通过任务状态同步
        break;

      case "sync:response":
        if (message.payload.agents) {
          taskStore.setAgents(message.payload.agents);
        }
        if (message.payload.tasks) {
          taskStore.setTasks(message.payload.tasks);
        }
        if (message.payload.runs) {
          taskStore.setRuns(message.payload.runs);
        }
        if (message.payload.jobs) {
          taskStore.setJobs(message.payload.jobs);
        }
        taskStore.setLastSyncTs(Date.now());
        break;

      case "control:response":
        if (!message.payload.success) {
          console.error("控制命令失败:", message.payload.error);
        }
        break;

      case "pong":
        // 心跳响应
        break;

      default:
        console.log("未处理的消息类型:", message.type);
    }
  }

  /** 发送设备上线消息 */
  private sendDeviceOnline(): void {
    const device = useDeviceStore.getState().currentDevice;
    if (device) {
      const message = createMessage(
        "device:online",
        device.id,
        null,
        device
      );
      this.send(message);
    }
  }

  /** 启动心跳 */
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.socket?.connected && this.currentDeviceId) {
        const message = createMessage(
          "ping",
          this.currentDeviceId,
          null,
          {}
        );
        this.send(message);
      }
    }, 30000); // 每30秒发送一次心跳
  }

  /** 获取或创建设备 ID */
  private async getOrCreateDeviceId(): Promise<string> {
    // TODO: 使用 AsyncStorage 持久化设备 ID
    // 临时使用随机 ID
    return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /** 获取设备名称 */
  private async getDeviceName(): Promise<string> {
    // TODO: 读取设备名称或使用默认名称
    return "我的手机";
  }
}

// 导出单例
export const connectionService = new ConnectionService();
