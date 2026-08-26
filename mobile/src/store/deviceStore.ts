/**
 * 设备连接状态管理
 */

import { create } from "zustand";
import type { DeviceInfo, ConnectionState } from "@ensemble/shared";

/** 连接质量等级 */
export type ConnectionQualityLevel = "excellent" | "good" | "fair" | "poor" | "unknown";

/** 连接质量指标 */
export interface ConnectionQuality {
  /** 最近一次 ping 延迟（毫秒） */
  latencyMs: number | null;
  /** 平均延迟（毫秒） */
  avgLatencyMs: number | null;
  /** 连接质量等级 */
  level: ConnectionQualityLevel;
  /** 最后一次 ping 时间戳 */
  lastPingAt: number | null;
  /** 最后一次 pong 时间戳 */
  lastPongAt: number | null;
  /** 丢包计数 */
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
  mode: "lan" | "relay";
  /** 目标地址 */
  url: string;
  /** 设备名称 */
  deviceName?: string;
  /** 断开原因 */
  disconnectReason?: string;
}

/** 中继连接状态 */
export type RelayStatus = "disconnected" | "connecting" | "connected" | "error";

interface DeviceStore {
  /** 当前设备信息 */
  currentDevice: DeviceInfo | null;
  /** 已发现的设备列表 */
  discoveredDevices: DeviceInfo[];
  /** 已连接的设备 */
  connectedDevice: DeviceInfo | null;
  /** 连接状态 */
  connectionState: ConnectionState;
  /** 最后错误 */
  lastError: string | null;
  /** 最后错误时间戳 */
  lastErrorAt: number | null;
  /** 连接质量 */
  connectionQuality: ConnectionQuality;
  /** 连接历史 */
  connectionHistory: ConnectionHistoryEntry[];

  /** 云端中继连接状态 */
  relayStatus: RelayStatus;
  /** 移动端在中继上发现的设备列表（桌面端设备） */
  relayDevices: DeviceInfo[];
  /** 当前选中的中继目标设备（桌面端） */
  relayTarget: DeviceInfo | null;
  /** 中继错误信息 */
  relayError: string | null;

  // Actions
  setCurrentDevice: (device: DeviceInfo) => void;
  setDiscoveredDevices: (devices: DeviceInfo[]) => void;
  addDiscoveredDevice: (device: DeviceInfo) => void;
  removeDiscoveredDevice: (deviceId: string) => void;
  setConnectedDevice: (device: DeviceInfo | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setError: (error: string | null) => void;
  setLastErrorAt: (timestamp: number | null) => void;
  setConnectionQuality: (quality: ConnectionQuality) => void;
  addConnectionHistory: (entry: ConnectionHistoryEntry) => void;
  clearConnectionHistory: () => void;
  setRelayStatus: (status: RelayStatus) => void;
  setRelayDevices: (devices: DeviceInfo[]) => void;
  upsertRelayDevice: (device: DeviceInfo) => void;
  removeRelayDevice: (deviceId: string) => void;
  setRelayTarget: (device: DeviceInfo | null) => void;
  setRelayError: (error: string | null) => void;
}

/** 默认连接质量 */
const defaultConnectionQuality: ConnectionQuality = {
  latencyMs: null,
  avgLatencyMs: null,
  level: "unknown",
  lastPingAt: null,
  lastPongAt: null,
  missedPongs: 0,
};

/** 最大连接历史记录数 */
const MAX_HISTORY_ENTRIES = 20;

export const useDeviceStore = create<DeviceStore>((set) => ({
  currentDevice: null,
  discoveredDevices: [],
  connectedDevice: null,
  connectionState: "disconnected",
  lastError: null,
  lastErrorAt: null,
  connectionQuality: { ...defaultConnectionQuality },
  connectionHistory: [],
  relayStatus: "disconnected",
  relayDevices: [],
  relayTarget: null,
  relayError: null,

  setCurrentDevice: (device) => set({ currentDevice: device }),
  setDiscoveredDevices: (devices) => set({ discoveredDevices: devices }),
  addDiscoveredDevice: (device) =>
    set((state) => ({
      discoveredDevices: [
        ...state.discoveredDevices.filter((d) => d.id !== device.id),
        device,
      ],
    })),
  removeDiscoveredDevice: (deviceId) =>
    set((state) => ({
      discoveredDevices: state.discoveredDevices.filter((d) => d.id !== deviceId),
    })),
  setConnectedDevice: (device) => set({ connectedDevice: device }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setError: (lastError) => set({ lastError }),
  setLastErrorAt: (lastErrorAt) => set({ lastErrorAt }),
  setConnectionQuality: (connectionQuality) => set({ connectionQuality }),
  addConnectionHistory: (entry) =>
    set((state) => ({
      connectionHistory: [entry, ...state.connectionHistory].slice(0, MAX_HISTORY_ENTRIES),
    })),
  clearConnectionHistory: () => set({ connectionHistory: [] }),
  setRelayStatus: (relayStatus) => set({ relayStatus }),
  setRelayDevices: (relayDevices) => set({ relayDevices }),
  upsertRelayDevice: (device) =>
    set((state) => ({
      relayDevices: [...state.relayDevices.filter((d) => d.id !== device.id), device],
    })),
  removeRelayDevice: (deviceId) =>
    set((state) => {
      const relayDevices = state.relayDevices.filter((d) => d.id !== deviceId);
      return {
        relayDevices,
        relayTarget: state.relayTarget?.id === deviceId ? relayDevices[0] ?? null : state.relayTarget,
      };
    }),
  setRelayTarget: (relayTarget) => set({ relayTarget }),
  setRelayError: (relayError) => set({ relayError }),
}));
