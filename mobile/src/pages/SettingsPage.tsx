/**
 * 设置页面
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
} from "react-native";
import { useDeviceStore } from "../store/deviceStore";
import { connectionService } from "../services/connection";
import { discoveryService } from "../services/discovery";

export default function SettingsPage() {
  const { currentDevice, connectedDevice, connectionState, discoveredDevices } =
    useDeviceStore();
  const [manualIp, setManualIp] = useState("");
  const [manualPort, setManualPort] = useState("3000");
  const [relayUrl, setRelayUrl] = useState("");
  const [autoConnect, setAutoConnect] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [connectionMode, setConnectionMode] = useState<"lan" | "relay">("lan");

  const isConnected = connectionState === "connected";

  // 手动连接（局域网）
  const handleManualConnect = async () => {
    if (!manualIp.trim()) {
      Alert.alert("错误", "请输入 IP 地址");
      return;
    }

    const port = parseInt(manualPort, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      Alert.alert("错误", "请输入有效的端口号");
      return;
    }

    const success = await connectionService.connect(manualIp.trim(), port);
    if (success) {
      Alert.alert("成功", "已连接到桌面端");
    } else {
      Alert.alert("失败", "无法连接到桌面端，请检查 IP 和端口");
    }
  };

  // 连接到云端中继服务器
  const handleRelayConnect = async () => {
    if (!relayUrl.trim()) {
      Alert.alert("错误", "请输入中继服务器地址");
      return;
    }

    // 配置中继服务器
    connectionService.setRelayConfig({ url: relayUrl.trim() });

    const success = await connectionService.connectViaRelay();
    if (success) {
      Alert.alert("成功", "已连接到中继服务器");
    } else {
      Alert.alert("失败", "无法连接到中继服务器，请检查地址");
    }
  };

  // 断开连接
  const handleDisconnect = () => {
    connectionService.disconnect();
  };

  // 刷新设备列表
  const handleRefreshDevices = () => {
    discoveryService.startScan();
    Alert.alert("提示", "正在扫描设备...");
  };

  // 渲染连接状态
  const renderConnectionStatus = () => {
    const statusColor =
      connectionState === "connected"
        ? "#10b981"
        : connectionState === "connecting" || connectionState === "reconnecting"
        ? "#f59e0b"
        : connectionState === "error"
        ? "#ef4444"
        : "#6b7280";

    const statusText =
      connectionState === "connected"
        ? "已连接"
        : connectionState === "connecting"
        ? "连接中..."
        : connectionState === "reconnecting"
        ? "重连中..."
        : connectionState === "error"
        ? "连接错误"
        : "未连接";

    return (
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>

        {connectedDevice && (
          <View style={styles.connectedDevice}>
            <Text style={styles.deviceLabel}>已连接设备:</Text>
            <Text style={styles.deviceName}>{connectedDevice.name}</Text>
            <Text style={styles.deviceIp}>{connectedDevice.ip}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* 连接状态 */}
      {renderConnectionStatus()}

      {/* 连接模式选择 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>连接模式</Text>
        <View style={styles.modeSelector}>
          <TouchableOpacity
            style={[
              styles.modeButton,
              connectionMode === "lan" && styles.modeButtonActive,
            ]}
            onPress={() => setConnectionMode("lan")}
          >
            <Text
              style={[
                styles.modeButtonText,
                connectionMode === "lan" && styles.modeButtonTextActive,
              ]}
            >
              📡 局域网直连
            </Text>
            <Text style={styles.modeDescription}>同一 WiFi 下直接连接</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeButton,
              connectionMode === "relay" && styles.modeButtonActive,
            ]}
            onPress={() => setConnectionMode("relay")}
          >
            <Text
              style={[
                styles.modeButtonText,
                connectionMode === "relay" && styles.modeButtonTextActive,
              ]}
            >
              ☁️ 云端中继
            </Text>
            <Text style={styles.modeDescription}>跨网络通过服务器连接</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 局域网连接 */}
      {connectionMode === "lan" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>局域网连接</Text>
          <View style={styles.manualConnectForm}>
            <TextInput
              style={styles.input}
              placeholder="IP 地址 (如 192.168.1.100)"
              placeholderTextColor="#6b7280"
              value={manualIp}
              onChangeText={setManualIp}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="端口 (默认 3000)"
              placeholderTextColor="#6b7280"
              value={manualPort}
              onChangeText={setManualPort}
              keyboardType="numeric"
            />
            <TouchableOpacity
              style={[
                styles.connectButton,
                isConnected && styles.disconnectButton,
              ]}
              onPress={isConnected ? handleDisconnect : handleManualConnect}
            >
              <Text style={styles.connectButtonText}>
                {isConnected ? "断开连接" : "连接"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 云端中继连接 */}
      {connectionMode === "relay" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>云端中继服务器</Text>
          <View style={styles.manualConnectForm}>
            <TextInput
              style={styles.input}
              placeholder="服务器地址 (如 http://your-server:3001)"
              placeholderTextColor="#6b7280"
              value={relayUrl}
              onChangeText={setRelayUrl}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[
                styles.connectButton,
                isConnected && styles.disconnectButton,
              ]}
              onPress={isConnected ? handleDisconnect : handleRelayConnect}
            >
              <Text style={styles.connectButtonText}>
                {isConnected ? "断开连接" : "连接中继服务器"}
              </Text>
            </TouchableOpacity>
            <Text style={styles.hintText}>
              需要先在阿里云部署中继服务器，详见文档
            </Text>
          </View>
        </View>
      )}

      {/* 设备发现 */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>发现的设备</Text>
          <TouchableOpacity onPress={handleRefreshDevices}>
            <Text style={styles.refreshButton}>刷新</Text>
          </TouchableOpacity>
        </View>

        {discoveredDevices.length === 0 ? (
          <Text style={styles.emptyText}>未发现设备</Text>
        ) : (
          discoveredDevices.map((device) => (
            <TouchableOpacity
              key={device.id}
              style={styles.deviceItem}
              onPress={() => {
                connectionService.connect(device.ip, device.wsPort);
              }}
            >
              <View style={styles.deviceInfo}>
                <Text style={styles.discoveredDeviceName}>{device.name}</Text>
                <Text style={styles.discoveredDeviceIp}>{device.ip}</Text>
              </View>
              <Text style={styles.deviceType}>{device.type}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* 本机信息 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>本机信息</Text>
        <View style={styles.deviceCard}>
          <Text style={styles.deviceCardLabel}>设备名称</Text>
          <Text style={styles.deviceCardValue}>
            {currentDevice?.name || "未知"}
          </Text>
        </View>
        <View style={styles.deviceCard}>
          <Text style={styles.deviceCardLabel}>设备 ID</Text>
          <Text style={styles.deviceCardValue}>
            {currentDevice?.id || "未知"}
          </Text>
        </View>
        <View style={styles.deviceCard}>
          <Text style={styles.deviceCardLabel}>应用版本</Text>
          <Text style={styles.deviceCardValue}>
            {currentDevice?.appVersion || "0.1.0"}
          </Text>
        </View>
      </View>

      {/* 设置选项 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>设置</Text>

        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>自动连接</Text>
            <Text style={styles.settingDescription}>
              启动时自动连接到上次的设备
            </Text>
          </View>
          <Switch
            value={autoConnect}
            onValueChange={setAutoConnect}
            trackColor={{ false: "#374151", true: "#10b981" }}
            thumbColor={autoConnect ? "#fff" : "#9ca3af"}
          />
        </View>

        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>通知</Text>
            <Text style={styles.settingDescription}>
              接收任务状态更新通知
            </Text>
          </View>
          <Switch
            value={notifications}
            onValueChange={setNotifications}
            trackColor={{ false: "#374151", true: "#10b981" }}
            thumbColor={notifications ? "#fff" : "#9ca3af"}
          />
        </View>
      </View>

      {/* 关于 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>关于</Text>
        <Text style={styles.aboutText}>
          合鸣（Ensemble）是一款桌面原生多 Agent 协作平台，支持手机与电脑端联动。
        </Text>
        <Text style={styles.versionText}>版本 0.1.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111827",
  },
  statusCard: {
    backgroundColor: "#1f2937",
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },
  connectedDevice: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  deviceLabel: {
    color: "#9ca3af",
    fontSize: 12,
    marginBottom: 4,
  },
  deviceName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
  deviceIp: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  refreshButton: {
    color: "#10b981",
    fontSize: 14,
  },
  manualConnectForm: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 16,
  },
  input: {
    backgroundColor: "#374151",
    borderRadius: 8,
    padding: 12,
    color: "#fff",
    marginBottom: 12,
  },
  connectButton: {
    backgroundColor: "#10b981",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  disconnectButton: {
    backgroundColor: "#ef4444",
  },
  connectButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  modeSelector: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  modeButton: {
    flex: 1,
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    alignItems: "center",
  },
  modeButtonActive: {
    backgroundColor: "#10b981",
    borderWidth: 2,
    borderColor: "#34d399",
  },
  modeButtonText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  modeButtonTextActive: {
    color: "#fff",
  },
  modeDescription: {
    color: "#6b7280",
    fontSize: 11,
    textAlign: "center",
  },
  hintText: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
  emptyText: {
    color: "#6b7280",
    textAlign: "center",
    padding: 20,
  },
  deviceItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  deviceInfo: {
    flex: 1,
  },
  discoveredDeviceName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
  discoveredDeviceIp: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  deviceType: {
    color: "#9ca3af",
    fontSize: 12,
    backgroundColor: "#374151",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  deviceCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  deviceCardLabel: {
    color: "#9ca3af",
    fontSize: 14,
  },
  deviceCardValue: {
    color: "#fff",
    fontSize: 14,
  },
  settingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
  settingDescription: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  aboutText: {
    color: "#d1d5db",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  versionText: {
    color: "#6b7280",
    fontSize: 12,
  },
});
