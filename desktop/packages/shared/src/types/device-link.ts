/**
 * 设备发现与互联类型
 * LAN(mDNS) 发现 + 云中继互联共用的数据结构
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
