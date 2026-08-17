/**
 * 连接服务
 * 管理与桌面端的 WebSocket 连接
 *
 * 支持两种连接模式：
 * 1. 局域网直连 — 直接连接桌面端 IP
 * 2. 云端中继 — 通过阿里云服务器中继
 */

import { io, Socket } from "socket.io-client";
import { Platform } from "react-native";
import * as Application from "expo-application";
import type {
  DeviceInfo,
  EnsembleMessage,
  ConnectionState,
  AgentEvent,
  Task,
  Run,
  Job,
  ChatMessage,
  AgentConfig,
} from "@ensemble/shared-protocol";
import { createMessage, isValidMessage } from "@ensemble/shared-protocol";
import { useDeviceStore } from "../store/deviceStore";
import { useTaskStore } from "../store/taskStore";
import { api } from "./api";
import { wsLink } from "./wslink";

// ==================== 类型定义 ====================

/**
 * 自用云端服务器（默认直连；账号/会话/IM 走这里）。
 * 真实地址来自本地 gitignore 的 server.config.js（见 server.config.example.js 模板）；
 * 缺省占位符仅供代码可编译，不会在 GitHub 暴露真实服务器。
 */
function loadServerHost(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require("../../server.config") as { cloud?: { host?: string; port?: number } };
    if (cfg?.cloud?.host) return cfg.cloud.host;
  } catch {
    /* 本地无配置时用占位符 */
  }
  return "YOUR_SERVER_HOST";
}
export const CLOUD_SERVER = { host: loadServerHost(), port: 8787 } as const;

/** 连接模式 */
export type ConnectionMode = "lan" | "relay";

/** 云端中继服务器配置 */
interface RelayConfig {
  /** 中继服务器地址 */
  url: string;
  /** 认证 token（可选） */
  token?: string;
}

/** 中继下发的设备形状（字段与 LAN 的 DeviceInfo 不同） */
export interface RelayDeviceShape {
  id: string;
  name: string;
  type: "desktop" | "mobile";
  connectedAt?: number;
  lastSeen?: number;
}

/** 中继转发的消息信封（字段为 timestamp 而非 ts） */
interface RelayEnvelope {
  id: string;
  from: string;
  fromName?: string;
  to: string;
  type: string;
  payload: any;
  timestamp?: number;
}

/** 连接质量指标 */
export interface ConnectionQuality {
  /** 最近一次 ping 延迟（毫秒） */
  latencyMs: number | null;
  /** 平均延迟（毫秒，基于最近 10 次 ping） */
  avgLatencyMs: number | null;
  /** 连接质量等级 */
  level: "excellent" | "good" | "fair" | "poor" | "unknown";
  /** 最后一次 ping 时间戳 */
  lastPingAt: number | null;
  /** 最后一次 pong 时间戳 */
  lastPongAt: number | null;
  /** 丢包计数（ping 未收到 pong） */
  missedPongs: number;
}

/** 连接历史记录 */
export interface ConnectionHistoryEntry {
  /** 连接时间戳 */
  connectedAt: number;
  /** 断开时间戳 */
  disconnectedAt?: number;
  /** 连接持续时间（毫秒） */
  durationMs?: number;
  /** 连接模式 */
  mode: ConnectionMode;
  /** 目标地址 */
  url: string;
  /** 设备信息 */
  deviceName?: string;
  /** 断开原因 */
  disconnectReason?: string;
}

/** 事件回调类型 */
type EventCallback = (...args: unknown[]) => void;

/** 事件类型映射 */
interface ConnectionEventMap {
  /** 连接状态变更 */
  "connection:state": (state: ConnectionState) => void;
  /** 设备上线 */
  "device:online": (device: DeviceInfo) => void;
  /** 设备离线 */
  "device:offline": (deviceId: string) => void;
  /** 任务创建响应 */
  "task:created": (data: { task?: Task; run?: Run; runId?: string }) => void;
  /** 任务状态更新 */
  "task:status": (data: { taskId: string; runId: string; status: string; jobs: Job[] }) => void;
  /** Agent 事件 */
  "agent:event": (data: { runId: string; jobId: string; event: AgentEvent }) => void;
  /** 聊天消息 */
  "chat:message": (message: ChatMessage) => void;
  /** 同步响应 */
  "sync:response": (data: { agents?: AgentConfig[]; tasks?: Task[]; runs?: Run[]; jobs?: Job[] }) => void;
  /** 控制命令响应 */
  "control:response": (data: { success: boolean; error?: string }) => void;
  /** 连接质量变更 */
  "quality:change": (quality: ConnectionQuality) => void;
  /** 中继原始信封（供远端控制台展示 fromName/timestamp 等） */
  "relay:inbound": (envelope: RelayEnvelope) => void;
  /** 错误 */
  error: (error: string) => void;
}

// ==================== AsyncStorage 兼容层 ====================

/** AsyncStorage 接口 */
interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** 创建 AsyncStorage 适配器（带降级） */
function createStorageAdapter(): StorageAdapter {
  try {
    // 尝试加载 @react-native-async-storage/async-storage
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    return {
      getItem: (key: string) => AsyncStorage.getItem(key),
      setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
      removeItem: (key: string) => AsyncStorage.removeItem(key),
    };
  } catch {
    // 降级为内存存储（不持久化）
    console.warn("AsyncStorage 不可用，设备 ID 将不会持久化");
    const memStore = new Map<string, string>();
    return {
      getItem: async (key: string) => memStore.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memStore.set(key, value);
      },
      removeItem: async (key: string) => {
        memStore.delete(key);
      },
    };
  }
}

// ==================== 常量 ====================

const DEVICE_ID_KEY = "@ensemble/device_id";
const DEVICE_NAME_KEY = "@ensemble/device_name";
const CONNECTION_HISTORY_KEY = "@ensemble/connection_history";

/** 心跳间隔（毫秒） */
const PING_INTERVAL_MS = 25_000;

/** 连接超时（毫秒） */
const CONNECT_TIMEOUT_MS = 10_000;

/** 最大重连次数 */
const MAX_RECONNECT_ATTEMPTS = 10;

/** 最大重连延迟（毫秒） */
const MAX_RECONNECT_DELAY_MS = 30_000;

/** ping 历史窗口大小 */
const PING_HISTORY_SIZE = 10;

/** 连接历史最大记录数 */
const MAX_HISTORY_ENTRIES = 20;

// ==================== 连接服务 ====================

class ConnectionService {
  private socket: Socket | null = null;
  /** 当前连接的 URL（避免访问 socket.io 内部 private 的 Manager.uri） */
  private currentUrl: string | null = null;
  private currentDeviceId: string | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
  private connectionMode: ConnectionMode = "lan";
  private relayConfig: RelayConfig | null = null;
  private storage = createStorageAdapter();

  // 连接质量追踪
  private pingTimestamp: number | null = null;
  private pingHistory: number[] = [];
  private missedPongs = 0;
  private lastPingAt: number | null = null;
  private lastPongAt: number | null = null;

  // 连接历史
  private currentConnectionStart: number | null = null;
  private connectionHistory: ConnectionHistoryEntry[] = [];

  // 事件订阅
  private eventListeners = new Map<string, Set<EventCallback>>();

  // 重连定时器
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ==================== 初始化 ====================

  /** 初始化当前设备信息 */
  async init(): Promise<void> {
    // 生成或读取设备 ID（持久化）
    this.currentDeviceId = await this.getOrCreateDeviceId();

    // 加载连接历史
    await this.loadConnectionHistory();

    // 设置当前设备信息
    const deviceInfo: DeviceInfo = {
      id: this.currentDeviceId,
      name: await this.getDeviceName(),
      type: "mobile",
      os: "React Native",
      appVersion: Application.nativeApplicationVersion ?? "0.8.12",
      wsPort: 0,
      httpPort: 0,
      ip: "0.0.0.0",
      lastSeen: Date.now(),
    };

    useDeviceStore.getState().setCurrentDevice(deviceInfo);
  }

  // ==================== 事件订阅 ====================

  /** 订阅事件 */
  on<K extends keyof ConnectionEventMap>(event: K, callback: ConnectionEventMap[K]): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as EventCallback);

    // 返回取消订阅函数
    return () => {
      this.eventListeners.get(event)?.delete(callback as EventCallback);
    };
  }

  /** 订阅一次性事件 */
  once<K extends keyof ConnectionEventMap>(event: K, callback: ConnectionEventMap[K]): void {
    const wrappedCallback: EventCallback = (...args: unknown[]) => {
      this.eventListeners.get(event)?.delete(wrappedCallback);
      (callback as EventCallback)(...args);
    };
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(wrappedCallback);
  }

  /** 触发事件 */
  private emit<K extends keyof ConnectionEventMap>(
    event: K,
    ...args: Parameters<ConnectionEventMap[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(...args);
        } catch (err) {
          console.error(`事件监听器错误 (${event}):`, err);
        }
      }
    }
  }

  /** 移除所有监听器 */
  removeAllListeners(): void {
    this.eventListeners.clear();
  }

  // ==================== 连接管理 ====================

  /** 配置云端中继服务器 */
  setRelayConfig(config: RelayConfig): void {
    this.relayConfig = config;
  }

  /** 连接到云端服务器/桌面端（REST 验证 + 原生 WebSocket 事件流） */
  async connect(ip: string, port: number): Promise<boolean> {
    this.connectionMode = "lan";
    // 清理旧连接（socket.io 中继 + WS 直连），失败不阻断
    try {
      if (this.socket?.connected) this.disconnect();
      wsLink.disconnect();
    } catch {
      /* 忽略清理异常 */
    }

    useDeviceStore.getState().setConnectionState("connecting");
    useDeviceStore.getState().setError(null);
    useDeviceStore.getState().setLastErrorAt(null);

    try {
      // 1. REST 探活
      const res = await fetch(`http://${ip}:${port}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        this.connectFailed(`服务器返回错误 (HTTP ${res.status})`);
        return false;
      }
      const health = (await res.json()) as Record<string, unknown>;

      // 2. 记录连接的服务器（api.ts 据此构造 baseUrl）
      const device: DeviceInfo = {
        id: typeof health.deviceId === "string" ? health.deviceId : `server-${ip}`,
        name: typeof health.deviceName === "string" && health.deviceName ? health.deviceName : (ip === CLOUD_SERVER.host ? "云端服务器" : `${ip}`),
        type: "desktop",
        os: typeof health.os === "string" ? health.os : "unknown",
        appVersion: typeof health.appVersion === "string" ? health.appVersion : "0.0.0",
        wsPort: typeof health.wsPort === "number" ? health.wsPort : port,
        httpPort: port,
        ip,
        lastSeen: Date.now(),
      };
      useDeviceStore.getState().setConnectedDevice(device);
      useDeviceStore.getState().setConnectionState("connected");
      this.emit("connection:state", "connected");

      // 3. 启动原生 WS 事件流（携带用户会话 token，云服务器无需 ws-token bootstrap）；上报设备信息用于多端在线
      const dev = useDeviceStore.getState().currentDevice;
      wsLink.on({ onConnectionState: (s) => this.handleWsState(s) });
      await wsLink.connect(
        ip,
        port,
        await api.getAuthToken(),
        dev ? { id: dev.id, name: dev.name, type: "mobile" } : undefined,
      );

      // 4. 拉取初始数据
      await this.syncData();
      return true;
    } catch (err) {
      this.connectFailed(err instanceof Error ? err.message : "连接失败");
      return false;
    }
  }

  /** 直连自用云端服务器（启动时自动调用；账号/会话/IM 全走云端） */
  async connectToCloud(): Promise<boolean> {
    return this.connect(CLOUD_SERVER.host, CLOUD_SERVER.port);
  }

  /** 直连失败处理 */
  private connectFailed(message: string): void {
    useDeviceStore.getState().setConnectionState("error");
    useDeviceStore.getState().setError(message);
    useDeviceStore.getState().setLastErrorAt(Date.now());
    this.emit("error", message);
    this.emit("connection:state", "error");
  }

  /** WS 事件流状态回调（直连模式） */
  private handleWsState(state: "connecting" | "connected" | "reconnecting" | "disconnected" | "error"): void {
    if (this.connectionMode !== "lan") return;
    if (state === "connected") {
      useDeviceStore.getState().setConnectionState("connected");
    } else if (state === "reconnecting") {
      useDeviceStore.getState().setConnectionState("reconnecting");
    } else if (state === "disconnected" || state === "error") {
      useDeviceStore.getState().setConnectionState("disconnected");
    }
    this.emit("connection:state", state === "error" ? "error" : state);
  }

  /** 配置并连接云端中继服务器（自动向中继注册本机为 mobile 设备） */
  async connectToRelay(relayUrl?: string, key?: string): Promise<boolean> {
    const url = relayUrl || this.relayConfig?.url;
    if (!url) {
      const error = "未配置中继服务器地址";
      useDeviceStore.getState().setRelayError(error);
      this.emit("error", error);
      return false;
    }

    // 保存中继配置（含可选认证密钥）
    this.relayConfig = { url, token: key || this.relayConfig?.token };
    this.connectionMode = "relay";

    // 记录连接历史开始时间
    this.currentConnectionStart = Date.now();

    useDeviceStore.getState().setRelayStatus("connecting");
    useDeviceStore.getState().setRelayError(null);
    useDeviceStore.getState().setRelayDevices([]);
    useDeviceStore.getState().setRelayTarget(null);

    const ok = await this.connectToServer(url);
    return ok;
  }

  /** 连接到云端中继服务器（等价的旧接口；仍会自动注册设备） */
  async connectViaRelay(relayUrl?: string): Promise<boolean> {
    return this.connectToRelay(relayUrl);
  }

  /** 底层连接实现 */
  private async connectToServer(url: string): Promise<boolean> {
    if (this.socket?.connected) {
      this.disconnectSocket();
    }

    useDeviceStore.getState().setConnectionState("connecting");
    useDeviceStore.getState().setError(null);
    useDeviceStore.getState().setLastErrorAt(null);

    try {
      this.socket = io(url, {
        transports: ["websocket"],
        reconnection: false, // 我们自己管理重连
        timeout: CONNECT_TIMEOUT_MS,
        auth: this.relayConfig?.token ? { token: this.relayConfig.token } : undefined,
      });
      this.currentUrl = url;

      this.setupSocketListeners();

      // 等待连接建立
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, CONNECT_TIMEOUT_MS);

        this.socket!.once("connect", () => {
          clearTimeout(timeout);
          resolve(true);
        });

        this.socket!.once("connect_error", (err) => {
          clearTimeout(timeout);
          const errorMsg = err.message || "连接失败";
          useDeviceStore.getState().setError(errorMsg);
          useDeviceStore.getState().setLastErrorAt(Date.now());
          this.emit("error", errorMsg);
          resolve(false);
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "连接失败";
      useDeviceStore.getState().setConnectionState("error");
      useDeviceStore.getState().setError(errorMsg);
      useDeviceStore.getState().setLastErrorAt(Date.now());
      this.emit("error", errorMsg);
      return false;
    }
  }

  /** 仅拆除 socket.io 中继套接字（不触碰云端 WS 事件流，保持 IM 连接不受影响） */
  private disconnectSocket(): void {
    // 清理重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.currentUrl = null;
    }

    this.reconnectAttempts = 0;
    this.missedPongs = 0;
    this.pingHistory = [];
  }

  /** 断开连接（局域网直连 / 云端直连模式） */
  disconnect(reason?: string): void {
    // 关闭直连 WS 事件流
    wsLink.disconnect();

    // 记录连接历史
    if (this.currentConnectionStart) {
      const entry: ConnectionHistoryEntry = {
        connectedAt: this.currentConnectionStart,
        disconnectedAt: Date.now(),
        durationMs: Date.now() - this.currentConnectionStart,
        mode: this.connectionMode,
        url: this.currentUrl || "unknown",
        deviceName: useDeviceStore.getState().connectedDevice?.name,
        disconnectReason: reason || "user_initiated",
      };
      this.addHistoryEntry(entry);
      this.currentConnectionStart = null;
    }

    this.disconnectSocket();

    if (this.connectionMode === "relay") {
      useDeviceStore.getState().setRelayStatus("disconnected");
      useDeviceStore.getState().setRelayDevices([]);
      useDeviceStore.getState().setRelayTarget(null);
    }

    useDeviceStore.getState().setConnectionState("disconnected");
    useDeviceStore.getState().setConnectedDevice(null);
    this.emit("connection:state", "disconnected");
  }

  /** 断开云端中继连接（仅断中继，不影响云端 IM/WS 连接） */
  disconnectRelay(): void {
    this.disconnectSocket();
    this.connectionMode = "relay";
    useDeviceStore.getState().setRelayStatus("disconnected");
    useDeviceStore.getState().setRelayDevices([]);
    useDeviceStore.getState().setRelayTarget(null);
    useDeviceStore.getState().setRelayError(null);
    useDeviceStore.getState().setConnectedDevice(null);
    this.emit("connection:state", "disconnected");
  }

  // ==================== 消息发送 ====================

  /** 发送消息（内部方法） */
  private send(message: unknown): void {
    if (!this.socket?.connected) {
      console.warn("未连接，无法发送消息");
      return;
    }
    this.socket.emit("message", message);
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
        type as keyof import("@ensemble/shared-protocol").MessageTypeMap,
        this.currentDeviceId,
        targetDeviceId,
        payload as never
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
        type as keyof import("@ensemble/shared-protocol").MessageTypeMap,
        this.currentDeviceId,
        null,
        payload as never
      );
      this.socket.emit("message", message);
    }
  }

  // ==================== 便捷方法 ====================

  /**
   * 选择中继的目标桌面设备。所有中继遥控消息（task/chat/control/sync）默认发给它。
   */
  selectRelayTarget(deviceId: string | null): void {
    if (!deviceId) {
      useDeviceStore.getState().setRelayTarget(null);
      return;
    }
    const dev = useDeviceStore.getState().relayDevices.find((d) => d.id === deviceId);
    if (dev) useDeviceStore.getState().setRelayTarget(dev);
  }

  /** 中继遥控的目标设备 ID；未选中时退回广播 */
  private relayTargetId(): string | null {
    return useDeviceStore.getState().relayTarget?.id || null;
  }

  /** 创建任务（直连模式走 REST；中继模式发给目标桌面设备） */
  async createTask(title: string, mode: "single" | "workflow" | "chat", input: unknown): Promise<void> {
    if (this.connectionMode === "lan") {
      const res = await api.createTask({ title, mode, input });
      if (res.data) {
        useTaskStore.getState().addRun(res.data);
        this.emit("task:created", { run: res.data });
      } else {
        this.emit("error", res.error || "创建任务失败");
      }
      return;
    }
    // 中继端桌面引擎读取 input.mode（见 desktop/packages/server/src/.../engine.ts），
    // 故需把 mode 嵌进 input： { title, input: { mode, ...input } }
    const relayPayload = {
      title,
      input: { mode, ...(input as object) },
    };
    const target = this.relayTargetId();
    if (target) this.sendToDevice(target, "task:create", relayPayload);
    else this.broadcast("task:create", relayPayload);
  }

  /** 发送聊天消息（直连模式走 REST；中继模式发给目标桌面设备） */
  async sendChatMessage(runId: string, content: string): Promise<void> {
    if (this.connectionMode === "lan") {
      const res = await api.sendChatMessage(runId, content);
      if (!res.data?.sent) {
        this.emit("error", res.error || "发送失败");
      }
      return;
    }
    const target = this.relayTargetId();
    if (target) this.sendToDevice(target, "chat:send", { runId, content });
    else this.broadcast("chat:send", { runId, content });
  }

  /** 发送控制命令（直连模式仅支持 run 取消；中继模式发给目标桌面设备） */
  async sendControlCommand(
    command: "pause" | "resume" | "cancel" | "retry",
    targetId: string,
    targetType: "task" | "run" | "job"
  ): Promise<void> {
    if (this.connectionMode === "lan") {
      if (command === "cancel" && targetType === "run") {
        const res = await api.cancelRun(targetId);
        if (!res.data?.cancelled) {
          this.emit("error", res.error || "取消失败");
        }
      } else {
        this.emit("error", `直连模式暂不支持 ${command}`);
      }
      return;
    }
    const target = this.relayTargetId();
    if (target) this.sendToDevice(target, "control:command", { command, targetId, targetType });
    else this.broadcast("control:command", { command, targetId, targetType });
  }

  /** 请求状态同步（直连模式拉取 REST；中继模式发给目标桌面设备） */
  async requestSync(_since?: number): Promise<void> {
    if (this.connectionMode === "lan") {
      await this.syncData();
      return;
    }
    const payload = { types: ["agents", "tasks", "runs", "jobs"], since: _since };
    const target = this.relayTargetId();
    if (target) this.sendToDevice(target, "sync:request", payload);
    else this.broadcast("sync:request", payload);
  }

  /** 直连模式：拉取桌面端初始数据到本地 store */
  private async syncData(): Promise<void> {
    const store = useTaskStore.getState();
    const [agents, tasks, runs] = await Promise.all([
      api.getAgents(),
      api.getTasks(),
      api.getRuns(),
    ]);
    if (agents.data) store.setAgents(agents.data);
    if (tasks.data) store.setTasks(tasks.data);
    if (runs.data) store.setRuns(runs.data);
    this.emit("sync:response", {
      agents: agents.data,
      tasks: tasks.data,
      runs: runs.data,
    });
    store.setLastSyncTs(Date.now());
  }

  // ==================== 状态查询 ====================

  /** 获取连接模式 */
  getConnectionMode(): ConnectionMode {
    return this.connectionMode;
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /** 获取当前设备 ID */
  getDeviceId(): string | null {
    return this.currentDeviceId;
  }

  /** 获取连接质量 */
  getConnectionQuality(): ConnectionQuality {
    const avgLatencyMs =
      this.pingHistory.length > 0
        ? Math.round(this.pingHistory.reduce((a, b) => a + b, 0) / this.pingHistory.length)
        : null;

    const latencyMs = this.pingHistory.length > 0 ? this.pingHistory[this.pingHistory.length - 1] : null;

    let level: ConnectionQuality["level"] = "unknown";
    if (avgLatencyMs !== null) {
      if (avgLatencyMs < 50) level = "excellent";
      else if (avgLatencyMs < 150) level = "good";
      else if (avgLatencyMs < 500) level = "fair";
      else level = "poor";
    }

    return {
      latencyMs,
      avgLatencyMs,
      level,
      lastPingAt: this.lastPingAt,
      lastPongAt: this.lastPongAt,
      missedPongs: this.missedPongs,
    };
  }

  /** 获取连接历史 */
  getConnectionHistory(): ConnectionHistoryEntry[] {
    return [...this.connectionHistory];
  }

  // ==================== Socket 监听器 ====================

  /** 设置 Socket 监听器 */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    // 连接成功
    this.socket.on("connect", () => {
      console.log(this.connectionMode === "relay" ? "已连接云端中继服务器" : "已连接到桌面端");
      this.reconnectAttempts = 0;
      this.currentConnectionStart = Date.now();

      if (this.connectionMode === "relay") {
        // 中继模式：必须先向中继注册本设备，否则服务器拒绝转发任何消息
        const dev = useDeviceStore.getState().currentDevice;
        useDeviceStore.getState().setRelayStatus("connected");
        useDeviceStore.getState().setConnectionQuality(this.getConnectionQuality());
        this.emit("connection:state", "connected");
        this.socket!.emit("device:register", {
          deviceId: this.currentDeviceId,
          deviceName: dev?.name || "我的手机",
          deviceType: "mobile",
        });
        // 中继用原生 ping/pong 心跳
        this.startPing();
        return;
      }

      // 局域网 / 云端直连模式
      useDeviceStore.getState().setConnectionState("connected");
      useDeviceStore.getState().setConnectionQuality(this.getConnectionQuality());
      this.emit("connection:state", "connected");

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

      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // 记录连接历史
      if (this.currentConnectionStart) {
        const entry: ConnectionHistoryEntry = {
          connectedAt: this.currentConnectionStart,
          disconnectedAt: Date.now(),
          durationMs: Date.now() - this.currentConnectionStart,
          mode: this.connectionMode,
          url: this.currentUrl || "unknown",
          deviceName: useDeviceStore.getState().connectedDevice?.name,
          disconnectReason: reason,
        };
        this.addHistoryEntry(entry);
        this.currentConnectionStart = null;
      }

      if (this.connectionMode === "relay") {
        // 中继断开：只更新中继状态，不动云端 IM
        useDeviceStore.getState().setRelayStatus(
          reason === "io client disconnect" ? "disconnected" : "error"
        );
        useDeviceStore.getState().setRelayDevices([]);
        useDeviceStore.getState().setRelayTarget(null);
        this.emit("connection:state", "disconnected");
        return;
      }

      useDeviceStore.getState().setConnectionState("disconnected");
      useDeviceStore.getState().setConnectedDevice(null);
      this.emit("connection:state", "disconnected");

      // 尝试重连（指数退避）
      this.scheduleReconnect();
    });

    // 连接错误
    this.socket.on("connect_error", (err) => {
      console.error("连接错误:", err.message);
      if (this.connectionMode === "relay") {
        const msg = err.message === "unauthorized"
          ? "认证失败：中继密钥错误或未授权"
          : err.message || "连接失败";
        useDeviceStore.getState().setRelayStatus("error");
        useDeviceStore.getState().setRelayError(msg);
      } else {
        useDeviceStore.getState().setError(err.message);
        useDeviceStore.getState().setLastErrorAt(Date.now());
      }
      this.emit("error", err.message);
    });

    // 服务器主动错误事件（如"设备未注册"/顶替提示）
    this.socket.on("error", (err: unknown) => {
      const msg =
        typeof err === "object" && err !== null && "message" in (err as Record<string, unknown>)
          ? String((err as Record<string, unknown>).message)
          : String(err);
      console.warn("服务器错误:", msg);
      if (this.connectionMode === "relay") {
        useDeviceStore.getState().setRelayError(msg || "中继服务器错误");
      }
    });

    // 接收消息：中继模式走 relay 信封（字段为 timestamp 而非 ts）
    this.socket.on("message", (data: unknown) => {
      if (this.connectionMode === "relay") {
        this.handleRelayInbound(data);
        return;
      }
      if (isValidMessage(data)) {
        this.handleMessage(data);
      }
    });

    // 中继心跳 pong（中继服务器对原生 "ping" 的响应）
    this.socket.on("pong", () => {
      if (this.connectionMode === "relay") this.handlePong();
    });

    // Socket.IO 特定事件（中继：注册确认 / 设备发现广播）
    this.socket.on("device:registered", (data: { success?: boolean; deviceId?: string; serverTime?: number }) => {
      if (this.connectionMode === "relay") {
        const dev = useDeviceStore.getState().currentDevice;
        useDeviceStore.getState().setRelayStatus(data?.success === false ? "error" : "connected");
        useDeviceStore.getState().setRelayDevices([]);
        useDeviceStore.getState().setRelayTarget(null);
        useDeviceStore.getState().setRelayError(null);
        // 注册成功后请求一次状态同步（同步桌面端 agents/tasks/runs）
        this.socket!.emit("message", this.toRelayEnvelope({
          to: "*",
          type: "sync:request",
          payload: { types: ["agents", "tasks", "runs", "jobs"] },
        }));
        console.log("[中继] 注册成功 device=", data?.deviceId || this.currentDeviceId, "name=", dev?.name);
      }
    });

    this.socket.on("device:list", (data: { devices?: RelayDeviceShape[] }) => {
      if (this.connectionMode !== "relay") return;
      const desktopDevices = (data?.devices || [])
        .filter((d) => d && typeof d.id === "string")
        .map((d) => this.toDeviceInfo(d));
      useDeviceStore.getState().setRelayDevices(desktopDevices);
      // 自动选中第一个在线桌面设备
      const target = useDeviceStore.getState().relayTarget;
      if (desktopDevices.length > 0 && !target) {
        useDeviceStore.getState().setRelayTarget(desktopDevices[0]);
      }
    });

    this.socket.on("device:online", (device: RelayDeviceShape) => {
      if (this.connectionMode === "relay") {
        const info = this.toDeviceInfo(device);
        useDeviceStore.getState().upsertRelayDevice(info);
        const target = useDeviceStore.getState().relayTarget;
        if (!target && info.type === "desktop") {
          useDeviceStore.getState().setRelayTarget(info);
        }
        this.emit("device:online", info);
        return;
      }
      // 局域网/云端直连：desktop 上线设为已连接设备
      if (device.type === "desktop") {
        useDeviceStore.getState().setConnectedDevice(this.toDeviceInfo(device));
        this.emit("device:online", this.toDeviceInfo(device));
      }
    });

    this.socket.on("device:offline", ({ deviceId }: { deviceId: string }) => {
      if (this.connectionMode === "relay") {
        useDeviceStore.getState().removeRelayDevice(deviceId);
        this.emit("device:offline", deviceId);
        return;
      }
      const connected = useDeviceStore.getState().connectedDevice;
      if (connected?.id === deviceId) {
        useDeviceStore.getState().setConnectedDevice(null);
      }
      this.emit("device:offline", deviceId);
    });
  }

  // ==================== 消息处理 ====================

  /** 处理接收到的消息 */
  private handleMessage(message: EnsembleMessage): void {
    const taskStore = useTaskStore.getState();

    switch (message.type) {
      case "task:create:response": {
        taskStore.addTask(message.payload.task);
        if (message.payload.run) {
          taskStore.addRun(message.payload.run);
        }
        this.emit("task:created", {
          task: message.payload.task,
          run: message.payload.run,
        });
        break;
      }

      case "task:status": {
        taskStore.updateRun(message.payload.runId, {
          status: message.payload.status as Run["status"],
        });
        message.payload.jobs.forEach((job) => {
          taskStore.updateJob(job.id, job);
        });
        this.emit("task:status", {
          taskId: message.payload.taskId,
          runId: message.payload.runId,
          status: message.payload.status,
          jobs: message.payload.jobs,
        });
        break;
      }

      case "agent:event": {
        const existingJob = taskStore.jobs.find((j) => j.id === message.payload.jobId);
        taskStore.updateJob(message.payload.jobId, {
          events: [...(existingJob?.events || []), message.payload.event],
        });
        this.emit("agent:event", {
          runId: message.payload.runId,
          jobId: message.payload.jobId,
          event: message.payload.event,
        });
        break;
      }

      case "chat:message": {
        this.emit("chat:message", message.payload);
        break;
      }

      case "sync:response": {
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
        this.emit("sync:response", {
          agents: message.payload.agents,
          tasks: message.payload.tasks,
          runs: message.payload.runs,
          jobs: message.payload.jobs,
        });
        break;
      }

      case "control:response": {
        if (!message.payload.success) {
          const error = message.payload.error || "控制命令执行失败";
          console.error("控制命令失败:", error);
          useDeviceStore.getState().setError(error);
          useDeviceStore.getState().setLastErrorAt(Date.now());
        }
        this.emit("control:response", {
          success: message.payload.success,
          error: message.payload.error,
        });
        break;
      }

      case "pong": {
        this.handlePong();
        break;
      }

      default:
        console.log("未处理的消息类型:", (message as { type: string }).type);
    }
  }

  // ==================== 中继助手 ====================

  /** 把中继设备形状映射为 LAN 的 DeviceInfo 结构（缺省字段补默认值） */
  private toDeviceInfo(d: RelayDeviceShape): DeviceInfo {
    return {
      id: d.id,
      name: d.name || d.id,
      type: d.type === "mobile" ? "mobile" : "desktop",
      os: "relay",
      appVersion: "",
      wsPort: 0,
      httpPort: 0,
      ip: "",
      lastSeen: d.lastSeen || d.connectedAt || Date.now(),
    };
  }

  /** 构造发给中继的 message 信封（中继无需 id/from/timestamp，转发时自行补） */
  private toRelayEnvelope(m: { to: string; type: string; payload: unknown }) {
    return { to: m.to, type: m.type, payload: m.payload };
  }

  /**
   * 处理中继入站消息。
   * 服务器只做原样转发，信封字段为 timestamp（LAN 是 ts），故在此归一化后复用
   * 与 handleMessage 相同的业务分支。桌面端回复类型：task:created / chat:message /
   * control:response / sync:response（以及未来的 task:status / agent:event）。
   */
  private handleRelayInbound(data: unknown): void {
    if (typeof data !== "object" || data === null) return;
    const env = data as RelayEnvelope;
    if (typeof env.type !== "string") return;
    const payload = env.payload as Record<string, any> | undefined;

    // 暴露原始信封给远端控制台
    this.emit("relay:inbound", env);

    const taskStore = useTaskStore.getState();

    switch (env.type) {
      case "task:created": {
        // 桌面端只回传 runId，本地无完整 Task/Run 可入 store
        const runId: string | undefined = (payload as { runId?: string } | undefined)?.runId;
        this.emit("task:created", { runId });
        break;
      }

      case "task:status": {
        const p = payload as { taskId: string; runId: string; status: string; jobs: Job[] } | undefined;
        if (p?.runId) {
          taskStore.updateRun(p.runId, { status: p.status as Run["status"] });
          (p.jobs || []).forEach((job) => taskStore.updateJob(job.id, job));
          this.emit("task:status", { taskId: p.taskId, runId: p.runId, status: p.status, jobs: p.jobs });
        }
        break;
      }

      case "agent:event": {
        const p = payload as { runId: string; jobId: string; event: AgentEvent } | undefined;
        if (p?.jobId) {
          const existingJob = taskStore.jobs.find((j) => j.id === p.jobId);
          taskStore.updateJob(p.jobId, { events: [...(existingJob?.events || []), p.event] });
          this.emit("agent:event", { runId: p.runId, jobId: p.jobId, event: p.event });
        }
        break;
      }

      case "chat:message": {
        const p = payload as { runId?: string; agentId?: string; content?: string; ts?: string | number } | undefined;
        if (typeof p?.content === "string") {
          const chatMessage: ChatMessage = {
            id: env.id || ("relay-" + Date.now()),
            runId: p.runId || "",
            agentId: p.agentId || "system",
            role: "assistant",
            content: p.content,
            ts: typeof p.ts === "string" ? p.ts : String(p.ts || env.timestamp || Date.now()),
          };
          this.emit("chat:message", chatMessage);
        }
        break;
      }

      case "sync:response": {
        const p = payload as { agents?: AgentConfig[]; tasks?: Task[]; runs?: Run[]; jobs?: Job[] } | undefined;
        if (p?.agents) taskStore.setAgents(p.agents);
        if (p?.tasks) taskStore.setTasks(p.tasks);
        if (p?.runs) taskStore.setRuns(p.runs);
        if (p?.jobs) taskStore.setJobs(p.jobs);
        taskStore.setLastSyncTs(Date.now());
        this.emit("sync:response", { agents: p?.agents, tasks: p?.tasks, runs: p?.runs, jobs: p?.jobs });
        break;
      }

      case "control:response": {
        const p = payload as { success?: boolean; error?: string } | undefined;
        const success = p?.success !== false;
        if (!success) {
          const error = p?.error || "控制命令执行失败";
          console.error("控制命令失败:", error);
          useDeviceStore.getState().setRelayError(error);
        }
        this.emit("control:response", { success, error: p?.error });
        break;
      }

      default:
        console.log("中继未处理的消息类型:", env.type);
    }
  }

  // ==================== 心跳 & 连接质量 ====================

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

  /** 启动心跳：中继模式用原生 ping/pong 事件，局域网用 message 通道 */
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.socket?.connected && this.currentDeviceId) {
        this.pingTimestamp = Date.now();
        this.lastPingAt = this.pingTimestamp;
        this.missedPongs++;

        if (this.connectionMode === "relay") {
          // 中继服务器监听原生 "ping" sent
          this.socket!.emit("ping");
        } else {
          const message = createMessage(
            "ping",
            this.currentDeviceId,
            null,
            {}
          );
          this.send(message);
        }

        // 更新设备 store 中的连接质量
        useDeviceStore.getState().setConnectionQuality(this.getConnectionQuality());
      }
    }, PING_INTERVAL_MS);
  }

  /** 处理 pong 响应 */
  private handlePong(): void {
    if (this.pingTimestamp) {
      const latency = Date.now() - this.pingTimestamp;
      this.pingHistory.push(latency);

      // 保持历史窗口大小
      if (this.pingHistory.length > PING_HISTORY_SIZE) {
        this.pingHistory.shift();
      }

      this.missedPongs = Math.max(0, this.missedPongs - 1);
      this.pingTimestamp = null;
      this.lastPongAt = Date.now();

      // 更新连接质量
      const quality = this.getConnectionQuality();
      useDeviceStore.getState().setConnectionQuality(quality);
      this.emit("quality:change", quality);
    }
  }

  // ==================== 重连 ====================

  /** 调度重连（指数退避） */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("达到最大重连次数，停止重连");
      useDeviceStore.getState().setConnectionState("error");
      useDeviceStore.getState().setError("重连失败，请检查网络连接后手动重试");
      useDeviceStore.getState().setLastErrorAt(Date.now());
      this.emit("connection:state", "error");
      this.emit("error", "重连失败，请检查网络连接后手动重试");
      return;
    }

    // 指数退避：1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
    const baseDelay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY_MS
    );
    // 添加随机抖动（±20%）
    const jitter = baseDelay * (0.8 + Math.random() * 0.4);
    const delay = Math.round(jitter);

    this.reconnectAttempts++;
    console.log(`将在 ${delay}ms 后重连 (第 ${this.reconnectAttempts} 次)`);

    useDeviceStore.getState().setConnectionState("reconnecting");
    this.emit("connection:state", "reconnecting");

    this.reconnectTimer = setTimeout(() => {
      if (this.socket) {
        // 尝试重新连接
        this.socket.connect();
      }
    }, delay);
  }

  // ==================== 设备 ID 持久化 ====================

  /** 获取或创建设备 ID（优先 Android ID，设备级稳定，重装/更新后不变，避免重复"我的手机"） */
  private async getOrCreateDeviceId(): Promise<string> {
    if (Platform.OS === "android") {
      try {
        const androidId = Application.getAndroidId();
        if (androidId) return "mobile-" + androidId;
      } catch (err) {
        console.warn("获取 Android ID 失败:", err);
      }
    }
    try {
      const stored = await this.storage.getItem(DEVICE_ID_KEY);
      if (stored) {
        return stored;
      }
    } catch (err) {
      console.warn("读取设备 ID 失败:", err);
    }

    // 生成新的设备 ID
    const id = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      await this.storage.setItem(DEVICE_ID_KEY, id);
    } catch (err) {
      console.warn("保存设备 ID 失败:", err);
    }

    return id;
  }

  /** 获取设备名称 */
  private async getDeviceName(): Promise<string> {
    try {
      const stored = await this.storage.getItem(DEVICE_NAME_KEY);
      if (stored) return stored;
    } catch {
      // 忽略
    }

    const name = "我的手机";
    try {
      await this.storage.setItem(DEVICE_NAME_KEY, name);
    } catch {
      // 忽略
    }

    return name;
  }

  /** 设置设备名称 */
  async setDeviceName(name: string): Promise<void> {
    await this.storage.setItem(DEVICE_NAME_KEY, name);
    const device = useDeviceStore.getState().currentDevice;
    if (device) {
      useDeviceStore.getState().setCurrentDevice({ ...device, name });
    }
  }

  // ==================== 连接历史 ====================

  /** 加载连接历史 */
  private async loadConnectionHistory(): Promise<void> {
    try {
      const stored = await this.storage.getItem(CONNECTION_HISTORY_KEY);
      if (stored) {
        this.connectionHistory = JSON.parse(stored);
      }
    } catch {
      this.connectionHistory = [];
    }
  }

  /** 保存连接历史 */
  private async saveConnectionHistory(): Promise<void> {
    try {
      await this.storage.setItem(
        CONNECTION_HISTORY_KEY,
        JSON.stringify(this.connectionHistory)
      );
    } catch (err) {
      console.warn("保存连接历史失败:", err);
    }
  }

  /** 添加历史记录 */
  private addHistoryEntry(entry: ConnectionHistoryEntry): void {
    this.connectionHistory.unshift(entry);

    // 限制历史记录数量
    if (this.connectionHistory.length > MAX_HISTORY_ENTRIES) {
      this.connectionHistory = this.connectionHistory.slice(0, MAX_HISTORY_ENTRIES);
    }

    this.saveConnectionHistory();
  }
}

// 导出单例
export const connectionService = new ConnectionService();
