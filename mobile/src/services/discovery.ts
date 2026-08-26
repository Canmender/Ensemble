/**
 * mDNS 设备发现服务
 * 自动发现局域网内的合鸣桌面端
 */

import Zeroconf from "react-native-zeroconf";
import type { DeviceInfo } from "@ensemble/shared";
import { useDeviceStore } from "../store/deviceStore";

const SERVICE_TYPE = "_ensemble._tcp";
const SERVICE_DOMAIN = "local.";

class DiscoveryService {
  private zeroconf: Zeroconf;
  private isScanning = false;
  private scanTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.zeroconf = new Zeroconf();

    // 监听服务发现事件
    this.zeroconf.on("found", this.onServiceFound.bind(this));
    this.zeroconf.on("resolved", this.onServiceResolved.bind(this));
    this.zeroconf.on("remove", this.onServiceRemoved.bind(this));
    this.zeroconf.on("error", this.onError.bind(this));
  }

  /** 开始扫描 */
  startScan(): void {
    if (this.isScanning) return;

    console.log("开始扫描合鸣设备...");
    this.isScanning = true;

    try {
      this.zeroconf.scan(SERVICE_TYPE, SERVICE_DOMAIN);
    } catch (error) {
      console.error("启动扫描失败:", error);
      this.isScanning = false;
    }

    // 30秒后自动停止扫描
    this.scanTimeout = setTimeout(() => {
      this.stopScan();
    }, 30000);
  }

  /** 停止扫描 */
  stopScan(): void {
    if (!this.isScanning) return;

    console.log("停止扫描");
    this.isScanning = false;

    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
      this.scanTimeout = null;
    }

    try {
      this.zeroconf.stop();
    } catch (error) {
      console.error("停止扫描失败:", error);
    }
  }

  /** 发布本机服务（可选，用于双向发现） */
  publishService(port: number, deviceId: string, deviceName: string): void {
    try {
      this.zeroconf.publishService(
        SERVICE_TYPE,
        SERVICE_DOMAIN,
        deviceName,
        port,
        {
          deviceId,
          deviceType: "mobile",
          appVersion: "0.1.0",
        }
      );
    } catch (error) {
      console.error("发布服务失败:", error);
    }
  }

  /** 取消发布服务 */
  unpublishService(): void {
    try {
      this.zeroconf.unpublishAll();
    } catch (error) {
      console.error("取消发布服务失败:", error);
    }
  }

  /** 服务发现回调 */
  private onServiceFound(service: any): void {
    console.log("发现服务:", service);
  }

  /** 服务解析回调 */
  private onServiceResolved(service: any): void {
    console.log("解析服务:", service);

    // 验证是合鸣桌面端
    if (!this.isValidEnsembleService(service)) return;

    const device: DeviceInfo = {
      id: service.txt?.deviceId || service.name,
      name: service.name,
      type: "desktop",
      os: service.txt?.os || "unknown",
      appVersion: service.txt?.appVersion || "0.0.0",
      wsPort: parseInt(service.txt?.wsPort || "0", 10),
      httpPort: parseInt(service.txt?.httpPort || "0", 10),
      ip: service.addresses?.[0] || service.host,
      lastSeen: Date.now(),
    };

    // 添加到已发现设备列表
    useDeviceStore.getState().addDiscoveredDevice(device);
  }

  /** 服务移除回调 */
  private onServiceRemoved(service: any): void {
    console.log("服务移除:", service);

    const deviceId = service.txt?.deviceId || service.name;
    useDeviceStore.getState().removeDiscoveredDevice(deviceId);
  }

  /** 错误回调 */
  private onError(error: any): void {
    console.error("mDNS 错误:", error);
  }

  /** 验证是否是有效的合鸣服务 */
  private isValidEnsembleService(service: any): boolean {
    // 检查服务类型
    if (service.type !== SERVICE_TYPE) return false;

    // 检查是否有必要的 TXT 记录
    const txt = service.txt;
    if (!txt) return false;

    // 验证设备类型
    if (txt.deviceType !== "desktop") return false;

    return true;
  }

  /** 手动添加设备（IP 直连） */
  async addManualDevice(ip: string, port: number): Promise<DeviceInfo | null> {
    try {
      // 尝试连接到设备
      const response = await fetch(`http://${ip}:${port}/api/health`, {
        timeout: 5000,
      } as any);

      if (!response.ok) return null;

      const data = await response.json();

      const device: DeviceInfo = {
        id: data.deviceId || `manual-${Date.now()}`,
        name: data.deviceName || `桌面端 (${ip})`,
        type: "desktop",
        os: data.os || "unknown",
        appVersion: data.appVersion || "0.0.0",
        wsPort: data.wsPort || port,
        httpPort: port,
        ip,
        lastSeen: Date.now(),
      };

      useDeviceStore.getState().addDiscoveredDevice(device);
      return device;
    } catch (error) {
      console.error("手动添加设备失败:", error);
      return null;
    }
  }
}

// 导出单例
export const discoveryService = new DiscoveryService();
