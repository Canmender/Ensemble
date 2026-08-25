/**
 * 「设备 / 我的电脑」页 — 移动端云端中继遥控
 *
 * 通过云端中继服务器（Socket.IO）发现并远程驱动桌面端：
 * 1. 填中继地址 + 密钥 → 连接并注册本机（mobile）
 * 2. 列出中继上在线的桌面设备
 * 3. 对选中的桌面设备：执行任务（task:create）/ 发消息（chat:send）
 * 4. 结果/回执展示区（桌面端 task:created / chat:message / sync:response 等回包）
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { connectionService } from "../services/connection";
import { useDeviceStore } from "../store/deviceStore";
import { colors, spacing, radius, fontSize , ms } from "../theme";
import { Card, Button, Input, SectionHeader } from "../components/ui";

interface LogEntry {
  id: string;
  at: number;
  from: "me" | "desktop" | "system";
  tag: string;
  text: string;
}

/** 安全地从本地 gitignore 配置读取中继地址（不硬编码密钥；缺省给占位） */
function loadDefaultRelayUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require("../../server.config") as { relayUrl?: string };
    if (typeof cfg?.relayUrl === "string" && cfg.relayUrl) return cfg.relayUrl;
  } catch {
    /* 本地无配置时用占位符 */
  }
  return "http://YOUR_RELAY_HOST:8888";
}

const DEFAULT_URL = loadDefaultRelayUrl();

let logSeq = 0;
function makeLog(from: LogEntry["from"], tag: string, text: string): LogEntry {
  logSeq += 1;
  return { id: String(logSeq), at: Date.now(), from, tag, text };
}

export default function DeviceRemotePage() {
  const relayStatus = useDeviceStore((s) => s.relayStatus);
  const relayDevices = useDeviceStore((s) => s.relayDevices);
  const relayTarget = useDeviceStore((s) => s.relayTarget);
  const relayError = useDeviceStore((s) => s.relayError);

  const [url, setUrl] = useState(DEFAULT_URL);
  const [key, setKey] = useState("");
  const [connecting, setConnecting] = useState(false);

  // 任务 / 聊天输入
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [chatContent, setChatContent] = useState("");
  const [sendingTask, setSendingTask] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);

  // 控制台日志
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<LogEntry[]>([]);
  const scrollRef = useRef<FlatList<LogEntry>>(null);

  const pushLog = useCallback((entry: LogEntry) => {
    logRef.current = [...logRef.current, entry].slice(-200);
    setLogs(logRef.current);
  }, []);

  const appendSystem = useCallback((text: string) => {
    pushLog(makeLog("system", "系统", text));
  }, [pushLog]);

  // 订阅中继回包事件
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    unsubs.push(
      connectionService.on("relay:inbound", (env) => {
        const payloadText =
          env && env.payload !== undefined ? JSON.stringify(env.payload) : "";
        pushLog(
          makeLog("desktop", "收到 " + (env?.type || "?"), payloadText),
        );
      }),
    );
    unsubs.push(
      connectionService.on("task:created", (data) => {
        if (data?.runId) pushLog(makeLog("desktop", "任务已创建", "runId=" + data.runId));
      }),
    );
    unsubs.push(
      connectionService.on("chat:message", (msg) => {
        if (msg?.content) pushLog(makeLog("desktop", "回复(" + (msg.agentId || "agent") + ")", msg.content));
      }),
    );
    unsubs.push(
      connectionService.on("control:response", (data) => {
        pushLog(
          makeLog("desktop", "控制", data?.success ? "成功" : ("失败 " + (data?.error || ""))),
        );
      }),
    );
    unsubs.push(
      connectionService.on("error", (err) => appendSystem("错误: " + err)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [pushLog, appendSystem]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    appendSystem("正在连接中继 " + url + " ...");
    const ok = await connectionService.connectToRelay(url, key.trim() || undefined);
    setConnecting(false);
    if (ok) {
      appendSystem("已连接中继，等待设备列表...");
    } else {
      appendSystem("连接中继失败，请检查地址/密钥/网络");
    }
  }, [url, key, appendSystem]);

  const handleDisconnect = useCallback(() => {
    connectionService.disconnectRelay();
    appendSystem("已断开中继连接");
  }, [appendSystem]);

  const handleSelectDevice = useCallback((deviceId: string) => {
    connectionService.selectRelayTarget(deviceId);
  }, []);

  const handleRunTask = useCallback(async () => {
    const title = taskTitle.trim();
    const prompt = taskPrompt.trim();
    if (!title || !prompt) {
      appendSystem("请填写任务标题与提示词");
      return;
    }
    if (!relayTarget) {
      appendSystem("请先选择一台桌面设备");
      return;
    }
    setSendingTask(true);
    appendSystem("发送任务: " + title + " → " + relayTarget.name);
    await connectionService.createTask(title, "single", { prompt, agentIds: [] });
    setSendingTask(false);
    setTaskTitle("");
    setTaskPrompt("");
  }, [taskTitle, taskPrompt, relayTarget, appendSystem]);

  const handleSendChat = useCallback(async () => {
    const content = chatContent.trim();
    if (!content) return;
    if (!relayTarget) {
      appendSystem("请先选择一台桌面设备");
      return;
    }
    setSendingChat(true);
    pushLog(makeLog("me", "发给 " + relayTarget.name, content));
    await connectionService.sendChatMessage("", content);
    setSendingChat(false);
    setChatContent("");
  }, [chatContent, relayTarget, appendSystem, pushLog]);

  const handleSync = useCallback(async () => {
    appendSystem("请求桌面端同步状态...");
    await connectionService.requestSync();
  }, [appendSystem]);

  const statusMeta =
    relayStatus === "connected"
      ? { color: colors.success, label: "已连接", icon: "cloud-done-outline" as const }
      : relayStatus === "connecting"
        ? { color: colors.warning, label: "连接中...", icon: "cloud-upload-outline" as const }
        : relayStatus === "error"
          ? { color: colors.danger, label: "连接错误", icon: "cloud-offline-outline" as const }
          : { color: colors.textFaint, label: "未连接", icon: "cloud-outline" as const };

  const renderLogRow = ({ item }: { item: LogEntry }) => {
    const isMe = item.from === "me";
    const isDesktop = item.from === "desktop";
    const tagColor = isMe ? colors.primary : isDesktop ? colors.success : colors.textMuted;
    return (
      <View style={styles.logRow}>
        <Text style={[styles.logTag, { color: tagColor }]}>
          [{item.tag}]
        </Text>
        <Text style={styles.logTime}>
          {" " + new Date(item.at).toLocaleTimeString()}
        </Text>
        <Text style={styles.logText}>{item.text}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 连接中继 */}
        <SectionHeader title="连接中继" />
        <Card style={styles.card}>
          <Text style={styles.fieldLabel}>中继地址</Text>
          <Input
            value={url}
            onChangeText={setUrl}
            placeholder="http://服务器:8888"
          />
          <Text style={styles.fieldLabel}>认证密钥（可选）</Text>
          <Input
            value={key}
            onChangeText={setKey}
            placeholder="输入中继共享密钥"
            secureTextEntry
          />
          <View style={styles.statusRow}>
            <Ionicons name={statusMeta.icon} size={16} color={statusMeta.color} />
            <Text style={[styles.statusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            {relayError ? <Text style={styles.relayError} numberOfLines={2}>{relayError}</Text> : null}
          </View>
          <View style={styles.row}>
            {relayStatus === "connected" || relayStatus === "connecting" ? (
              <Button
                title="断开"
                variant="danger"
                onPress={handleDisconnect}
                style={styles.flexBtn}
                disabled={relayStatus === "connecting"}
              />
            ) : (
              <Button
                title="连接中继"
                onPress={handleConnect}
                loading={connecting}
                style={styles.flexBtn}
              />
            )}
          </View>
        </Card>

        {/* 在线设备 */}
        <SectionHeader title="在线设备" />
        <Card style={styles.card}>
          {relayStatus !== "connected" ? (
            <View style={styles.emptyInline}>
              <Text style={styles.hint}>连接中继后可发现桌面端</Text>
            </View>
          ) : relayDevices.length === 0 ? (
            <View style={styles.emptyInline}>
              <Text style={styles.hint}>
                未发现桌面设备。电脑需在设置中打开多端协作并连接中继。
              </Text>
            </View>
          ) : (
            relayDevices.map((dev) => {
              const selected = relayTarget?.id === dev.id;
              return (
                <TouchableOpacity
                  key={dev.id}
                  style={[styles.deviceItem, selected && styles.deviceItemActive]}
                  onPress={() => handleSelectDevice(dev.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.deviceIcon}>
                    <Ionicons
                      name={dev.type === "mobile" ? "phone-portrait-outline" : "desktop-outline"}
                      size={20}
                      color={colors.primary}
                    />
                  </View>
                  <View style={styles.deviceBody}>
                    <Text style={styles.deviceName}>{dev.name || dev.id}</Text>
                    <Text style={styles.deviceMeta}>
                      {dev.type === "mobile" ? "移动端" : "桌面端"} · {dev.id.slice(-8)}
                    </Text>
                  </View>
                  {selected && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                  )}
                </TouchableOpacity>
              );
            })
          )}
          {relayStatus === "connected" && (
            <TouchableOpacity style={styles.syncBtn} onPress={handleSync} activeOpacity={0.7}>
              <Ionicons name="refresh" size={14} color={colors.primary} />
              <Text style={styles.syncBtnText}>重新同步桌面状态</Text>
            </TouchableOpacity>
          )}
        </Card>

        {/* 执行任务 */}
        <SectionHeader title="执行任务" />
        <Card style={styles.card}>
          <Text style={styles.fieldLabel}>任务标题</Text>
          <Input value={taskTitle} onChangeText={setTaskTitle} placeholder="例如：整理项目文档" />
          <Text style={styles.fieldLabel}>任务提示词</Text>
          <Input
            value={taskPrompt}
            onChangeText={setTaskPrompt}
            placeholder="描述想让电脑帮你做的事"
            multiline
          />
          <Button
            title={relayTarget ? ("执行任务 → " + relayTarget.name) : "先选择设备"}
            onPress={handleRunTask}
            loading={sendingTask}
            disabled={!relayTarget}
            style={styles.primaryBtn}
          />
        </Card>

        {/* 发消息 */}
        <SectionHeader title="发消息" />
        <Card style={styles.card}>
          <View style={styles.chatRow}>
            <Input
              value={chatContent}
              onChangeText={setChatContent}
              placeholder="输入消息，回车发给电脑"
              style={styles.chatInput}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !relayTarget && styles.sendBtnDisabled]}
              onPress={handleSendChat}
              disabled={sendingChat || !relayTarget}
              activeOpacity={0.8}
            >
              {sendingChat ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={16} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </Card>

        {/* 结果 / 控制台 */}
        <SectionHeader title="远程控制台" />
        <Card style={[styles.card, styles.consoleCard]}>
          <FlatList
            ref={scrollRef}
            data={logs}
            keyExtractor={(item) => item.id}
            renderItem={renderLogRow}
            ListEmptyComponent={
              <View style={styles.emptyInline}>
                <Text style={styles.hint}>桌面端的执行结果 / 回复会显示在这里</Text>
              </View>
            }
            showsVerticalScrollIndicator
            style={styles.consoleList}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = ms({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl * 2 },
  card: { marginBottom: spacing.md },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: "600",
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  statusText: { fontSize: fontSize.sm, fontWeight: "600" },
  relayError: { color: colors.danger, fontSize: fontSize.xs, flexShrink: 1, marginLeft: spacing.sm },
  row: { flexDirection: "row", marginTop: spacing.md },
  flexBtn: { flex: 1 },
  primaryBtn: { marginTop: spacing.lg },
  emptyInline: { paddingVertical: spacing.lg, alignItems: "center" },
  hint: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: "center", lineHeight: 20 },
  deviceItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  deviceItemActive: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  deviceIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceBody: { flex: 1 },
  deviceName: { color: colors.text, fontSize: fontSize.md, fontWeight: "600" },
  deviceMeta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  syncBtnText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: "600" },
  chatRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chatInput: { flex: 1, minHeight: 48 },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  consoleCard: { minHeight: 180 },
  consoleList: { maxHeight: 240, minHeight: 80 },
  logRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: spacing.xs },
  logTag: { fontSize: fontSize.xs, fontWeight: "700" },
  logTime: { fontSize: fontSize.xs, color: colors.textFaint },
  logText: { fontSize: fontSize.xs, color: colors.textMuted, flexShrink: 1 },
});
