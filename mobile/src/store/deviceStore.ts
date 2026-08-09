/**
 * 设备连接状态管理
 */

import { create } from "zustand";
import type { DeviceInfo, ConnectionState } from "@ensemble/shared-protocol";

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

  // Actions
  setCurrentDevice: (device: DeviceInfo) => void;
  setDiscoveredDevices: (devices: DeviceInfo[]) => void;
  addDiscoveredDevice: (device: DeviceInfo) => void;
  removeDiscoveredDevice: (deviceId: string) => void;
  setConnectedDevice: (device: DeviceInfo | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setError: (error: string | null) => void;
}

export const useDeviceStore = create<DeviceStore>((set) => ({
  currentDevice: null,
  discoveredDevices: [],
  connectedDevice: null,
  connectionState: "disconnected",
  lastError: null,

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
}));
