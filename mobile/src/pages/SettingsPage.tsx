/**
 * Settings Page
 * Connection management, relay config, debug info, app version.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useDeviceStore } from "../store/deviceStore";
import { connectionService } from "../services/connection";
import { discoveryService } from "../services/discovery";

const APP_VERSION = "0.4.3";
const MAX_HISTORY = 10;

/** Connection history entry */
interface ConnectionRecord {
  id: string;
  label: string;
  address: string;
  mode: "lan" | "relay";
  lastConnected: number;
}

/** In-memory connection history. TODO: persist with AsyncStorage. */
let connectionHistory: ConnectionRecord[] = [];
let savedRelayUrl = "";
let savedRelayToken = "";

export default function SettingsPage() {
  const { currentDevice, connectedDevice, connectionState, discoveredDevices, lastError } =
    useDeviceStore();
  const [manualIp, setManualIp] = useState("");
  const [manualPort, setManualPort] = useState("3000");
  const [relayUrl, setRelayUrl] = useState(savedRelayUrl);
  const [relayToken, setRelayToken] = useState(savedRelayToken);
  const [autoConnect, setAutoConnect] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [connectionMode, setConnectionMode] = useState<"lan" | "relay">("lan");
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [history, setHistory] = useState<ConnectionRecord[]>(connectionHistory);
  const [showDebug, setShowDebug] = useState(false);
  const [connectStartTime, setConnectStartTime] = useState<number | null>(null);
  const [lastConnectDuration, setLastConnectDuration] = useState<number | null>(null);
  const [connectAttempts, setConnectAttempts] = useState(0);

  const isConnected = connectionState === "connected";

  /** Add entry to connection history */
  const addToHistory = useCallback(
    (label: string, address: string, mode: "lan" | "relay") => {
      const entry: ConnectionRecord = {
        id: `${mode}-${address}-${Date.now()}`,
        label,
        address,
        mode,
        lastConnected: Date.now(),
      };
      connectionHistory = [
        entry,
        ...connectionHistory.filter((h) => h.address !== address || h.mode !== mode),
      ].slice(0, MAX_HISTORY);
      setHistory([...connectionHistory]);
    },
    []
  );

  /** Ping before connecting (LAN only) */
  const handlePing = async () => {
    if (!manualIp.trim()) {
      Alert.alert("提示", "请先输入 IP 地址");
      return;
    }
    const port = parseInt(manualPort, 10) || 3000;
    setIsPinging(true);
    setPingResult(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const start = Date.now();
      const response = await fetch(`http://${manualIp.trim()}:${port}/api/health`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latency = Date.now() - start;

      if (response.ok) {
        setPingResult(`可达 (${latency}ms)`);
      } else {
        setPingResult(`响应异常 (${response.status})`);
      }
    } catch (err) {
      setPingResult("不可达");
    } finally {
      setIsPinging(false);
    }
  };

  /** Manual LAN connect */
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

    setConnectStartTime(Date.now());
    setConnectAttempts((prev) => prev + 1);
    const success = await connectionService.connect(manualIp.trim(), port);
    setLastConnectDuration(Date.now() - (connectStartTime || Date.now()));

    if (success) {
      addToHistory(
        `${manualIp.trim()}:${port}`,
        `${manualIp.trim()}:${port}`,
        "lan"
      );
      Alert.alert("成功", "已连接到桌面端");
    } else {
      Alert.alert("失败", "无法连接到桌面端，请检查 IP 和端口");
    }
  };

  /** Relay connect */
  const handleRelayConnect = async () => {
    if (!relayUrl.trim()) {
      Alert.alert("错误", "请输入中继服务器地址");
      return;
    }

    // Save relay config
    savedRelayUrl = relayUrl.trim();
    savedRelayToken = relayToken.trim();
    connectionService.setRelayConfig({
      url: relayUrl.trim(),
      token: relayToken.trim() || undefined,
    });

    setConnectStartTime(Date.now());
    setConnectAttempts((prev) => prev + 1);
    const success = await connectionService.connectViaRelay();
    setLastConnectDuration(Date.now() - (connectStartTime || Date.now()));

    if (success) {
      addToHistory(relayUrl.trim(), relayUrl.trim(), "relay");
      Alert.alert("成功", "已连接到中继服务器");
    } else {
      Alert.alert("失败", "无法连接到中继服务器，请检查地址");
    }
  };

  /** Disconnect */
  const handleDisconnect = () => {
    connectionService.disconnect();
    setConnectAttempts(0);
  };

  /** Connect from history entry */
  const handleHistoryConnect = async (record: ConnectionRecord) => {
    if (record.mode === "lan") {
      const parts = record.address.split(":");
      const ip = parts[0];
      const port = parseInt(parts[1], 10) || 3000;
      setManualIp(ip);
      setManualPort(String(port));
      setConnectStartTime(Date.now());
      setConnectAttempts((prev) => prev + 1);
      const success = await connectionService.connect(ip, port);
      setLastConnectDuration(Date.now() - (connectStartTime || Date.now()));
      if (!success) {
        Alert.alert("失败", "无法连接到该设备");
      }
    } else {
      setRelayUrl(record.address);
      connectionService.setRelayConfig({
        url: record.address,
        token: savedRelayToken || undefined,
      });
      setConnectStartTime(Date.now());
      setConnectAttempts((prev) => prev + 1);
      const success = await connectionService.connectViaRelay();
      setLastConnectDuration(Date.now() - (connectStartTime || Date.now()));
      if (!success) {
        Alert.alert("失败", "无法连接到中继服务器");
      }
    }
  };

  /** Refresh device list */
  const handleRefreshDevices = () => {
    discoveryService.startScan();
    Alert.alert("提示", "正在扫描设备...");
  };

  /** Clear history */
  const handleClearHistory = () => {
    connectionHistory = [];
    setHistory([]);
  };

  // Connection status rendering
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
            {lastConnectDuration !== null && (
              <Text style={styles.deviceIp}>
                连接耗时: {lastConnectDuration}ms
              </Text>
            )}
          </View>
        )}

        {lastError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{lastError}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* Connection status */}
      {renderConnectionStatus()}

      {/* Connection mode selector */}
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
              LAN 直连
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
              云端中继
            </Text>
            <Text style={styles.modeDescription}>跨网络通过服务器连接</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* LAN connect */}
      {connectionMode === "lan" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>局域网连接</Text>
          <View style={styles.card}>
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

            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.secondaryButton, isPinging && styles.buttonDisabled]}
                onPress={handlePing}
                disabled={isPinging}
              >
                {isPinging ? (
                  <ActivityIndicator size="small" color="#10b981" />
                ) : (
                  <Text style={styles.secondaryButtonText}>Ping 测试</Text>
                )}
              </TouchableOpacity>
              {pingResult && (
                <Text
                  style={[
                    styles.pingResult,
                    { color: pingResult.includes("可达") ? "#10b981" : "#ef4444" },
                  ]}
                >
                  {pingResult}
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.connectButton,
                isConnected && styles.disconnectButton,
              ]}
              onPress={isConnected ? handleDisconnect : handleManualConnect}
            >
              {connectionState === "connecting" ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.connectButtonText}>
                  {isConnected ? "断开连接" : "连接"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Relay connect */}
      {connectionMode === "relay" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>云端中继服务器</Text>
          <View style={styles.card}>
            <TextInput
              style={styles.input}
              placeholder="服务器地址 (如 http://your-server:3001)"
              placeholderTextColor="#6b7280"
              value={relayUrl}
              onChangeText={setRelayUrl}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="认证 Token (可选)"
              placeholderTextColor="#6b7280"
              value={relayToken}
              onChangeText={setRelayToken}
              autoCapitalize="none"
              secureTextEntry
            />

            <TouchableOpacity
              style={[
                styles.connectButton,
                isConnected && styles.disconnectButton,
              ]}
              onPress={isConnected ? handleDisconnect : handleRelayConnect}
            >
              {connectionState === "connecting" ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.connectButtonText}>
                  {isConnected ? "断开连接" : "连接中继服务器"}
                </Text>
              )}
            </TouchableOpacity>
            <Text style={styles.hintText}>
              需要先在阿里云部署中继服务器，详见文档
            </Text>
          </View>
        </View>
      )}

      {/* Connection history */}
      {history.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>连接历史</Text>
            <TouchableOpacity onPress={handleClearHistory}>
              <Text style={styles.dangerLink}>清空</Text>
            </TouchableOpacity>
          </View>
          {history.map((record) => (
            <TouchableOpacity
              key={record.id}
              style={styles.historyItem}
              onPress={() => handleHistoryConnect(record)}
            >
              <View style={styles.historyInfo}>
                <Text style={styles.historyLabel}>{record.label}</Text>
                <Text style={styles.historyMeta}>
                  {record.mode === "lan" ? "LAN" : "Relay"} ·{" "}
                  {new Date(record.lastConnected).toLocaleDateString()}
                </Text>
              </View>
              <Text style={styles.historyArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Device discovery */}
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

      {/* Device info */}
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
          <Text style={styles.deviceCardValue}>{APP_VERSION}</Text>
        </View>
      </View>

      {/* Debug info */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => setShowDebug(!showDebug)}
        >
          <Text style={styles.sectionTitle}>调试信息</Text>
          <Text style={styles.refreshButton}>
            {showDebug ? "收起" : "展开"}
          </Text>
        </TouchableOpacity>

        {showDebug && (
          <View style={styles.card}>
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>连接状态</Text>
              <Text style={styles.debugValue}>{connectionState}</Text>
            </View>
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>连接模式</Text>
              <Text style={styles.debugValue}>
                {connectionService.getConnectionMode()}
              </Text>
            </View>
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>连接尝试次数</Text>
              <Text style={styles.debugValue}>{connectAttempts}</Text>
            </View>
            {lastConnectDuration !== null && (
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>上次连接耗时</Text>
                <Text style={styles.debugValue}>{lastConnectDuration}ms</Text>
              </View>
            )}
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>发现设备数</Text>
              <Text style={styles.debugValue}>{discoveredDevices.length}</Text>
            </View>
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>已连接设备</Text>
              <Text style={styles.debugValue}>
                {connectedDevice?.name || "无"}
              </Text>
            </View>
            {lastError && (
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>最后错误</Text>
                <Text style={[styles.debugValue, { color: "#ef4444" }]}>
                  {lastError}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Settings */}
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

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>关于</Text>
        <Text style={styles.aboutText}>
          合鸣（Ensemble）是一款桌面原生多 Agent 协作平台，支持手机与电脑端联动。
        </Text>
        <Text style={styles.versionText}>版本 {APP_VERSION}</Text>
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
  errorBanner: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  errorBannerText: {
    color: "#ef4444",
    fontSize: 13,
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
  dangerLink: {
    color: "#ef4444",
    fontSize: 14,
  },
  card: {
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryButton: {
    backgroundColor: "#374151",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 12,
  },
  secondaryButtonText: {
    color: "#10b981",
    fontSize: 14,
    fontWeight: "500",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  pingResult: {
    fontSize: 13,
    fontWeight: "500",
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
  historyItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  historyInfo: {
    flex: 1,
  },
  historyLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
  historyMeta: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  historyArrow: {
    color: "#6b7280",
    fontSize: 20,
  },
  debugRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  debugLabel: {
    color: "#9ca3af",
    fontSize: 13,
  },
  debugValue: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
    maxWidth: "60%",
    textAlign: "right",
  },
});
