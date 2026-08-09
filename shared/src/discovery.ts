/**
 * 设备发现与连接协议
 * 基于 mDNS/Bonjour 实现局域网自动发现
 */

/** 设备类型 */
export type DeviceType = "desktop" | "mobile";

/** 设备信息 */
export interface DeviceInfo {
  /** 设备唯一 ID（首次启动时生成并持久化） */
  id: string;
  /** 设备名称（用户可自定义） */
  name: string;
  /** 设备类型 */
  type: DeviceType;
  /** 操作系统 */
  os: string;
  /** 应用版本 */
  appVersion: string;
  /** WebSocket 端口 */
  wsPort: number;
  /** REST API 端口 */
  httpPort: number;
  /** 设备 IP 地址 */
  ip: string;
  /** 最后在线时间戳 */
  lastSeen: number;
}

/** mDNS 服务类型 */
export const MDNS_SERVICE_TYPE = "ensemble";
export const MDNS_SERVICE_PROTOCOL = "tcp";
export const MDNS_SERVICE_DOMAIN = "local";

/** 设发现配置 */
export interface DiscoveryConfig {
  /** mDNS 服务类型（默认 _ensemble._tcp.local） */
  serviceType?: string;
  /** 广播间隔（毫秒，默认 10000） */
  broadcastInterval?: number;
  /** 设备离线超时（毫秒，默认 30000） */
  offlineTimeout?: number;
}

/** 连接状态 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/** 连接详情 */
export interface ConnectionInfo {
  state: ConnectionState;
  deviceId: string;
  deviceName: string;
  connectedAt?: number;
  lastPing?: number;
  error?: string;
}
