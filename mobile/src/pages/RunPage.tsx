/**
 * Run 详情页面
 * 显示任务执行的完整生命周期：状态、Agent 信息、Job 事件、工具调用
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useTaskStore } from "../store/taskStore";
import { useDeviceStore } from "../store/deviceStore";
import { connectionService } from "../services/connection";
import type { AgentEvent, RunStatus } from "@ensemble/shared-protocol";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../App";
import { colors } from "../theme";

type RunPageProps = NativeStackScreenProps<RootStackParamList, "Run">;

/** 状态颜色映射 */
function getStatusColor(status: RunStatus | string): string {
  switch (status) {
    case "running":
      return "#f59e0b";
    case "success":
      return "#10b981";
    case "error":
      return "#ef4444";
    case "cancelled":
      return "#6b7280";
    case "queued":
      return "#6366f1";
    default:
      return "#374151";
  }
}

/** 状态标签文本 */
function getStatusLabel(status: RunStatus | string): string {
  switch (status) {
    case "running":
      return "运行中";
    case "success":
      return "已完成";
    case "error":
      return "错误";
    case "cancelled":
      return "已取消";
    case "queued":
      return "排队中";
    default:
      return status;
  }
}

/** 渲染单个 AgentEvent */
function renderEvent(event: AgentEvent, index: number) {
  switch (event.type) {
    case "status":
      return (
        <View key={index} style={eventStyles.row}>
          <Text style={eventStyles.timestamp}>
            {new Date(event.ts).toLocaleTimeString()}
          </Text>
          <View style={[eventStyles.badge, { backgroundColor: getStatusColor(event.status) }]}>
            <Text style={eventStyles.badgeText}>{event.status}</Text>
          </View>
          {event.detail && (
            <Text style={eventStyles.detail}>{event.detail}</Text>
          )}
        </View>
      );

    case "output":
      return (
        <View key={index} style={eventStyles.outputRow}>
          <Text style={eventStyles.timestamp}>
            {new Date(event.ts).toLocaleTimeString()}
          </Text>
          <Text style={eventStyles.outputPrefix}>
            {event.kind === "thinking" ? "[思考] " : ""}
          </Text>
          <Text style={eventStyles.outputText}>{event.text}</Text>
        </View>
      );

    case "tool_use":
      return (
        <View key={index} style={eventStyles.toolRow}>
          <Text style={eventStyles.timestamp}>
            {new Date(event.ts).toLocaleTimeString()}
          </Text>
          <View style={eventStyles.toolBadge}>
            <Text style={eventStyles.toolBadgeText}>调用工具</Text>
          </View>
          <Text style={eventStyles.toolName}>{event.tool}</Text>
          {event.input != null && (
            <Text style={eventStyles.toolInput} numberOfLines={3}>
              {typeof event.input === "string"
                ? event.input
                : JSON.stringify(event.input, null, 2)}
            </Text>
          )}
        </View>
      );

    case "tool_result":
      return (
        <View key={index} style={eventStyles.toolResultRow}>
          <Text style={eventStyles.timestamp}>
            {new Date(event.ts).toLocaleTimeString()}
          </Text>
          <View style={eventStyles.toolResultBadge}>
            <Text style={eventStyles.toolResultBadgeText}>工具结果</Text>
          </View>
          <Text style={eventStyles.toolName}>{event.tool}</Text>
          <Text style={eventStyles.toolOutput} numberOfLines={5}>
            {event.output}
          </Text>
        </View>
      );

    case "error":
      return (
        <View key={index} style={eventStyles.errorRow}>
          <Text style={eventStyles.timestamp}>
            {new Date(event.ts).toLocaleTimeString()}
          </Text>
          <Text style={eventStyles.errorText}>
            {event.code ? `[${event.code}] ` : ""}
            {event.message}
          </Text>
        </View>
      );

    case "done":
      return (
        <View key={index} style={eventStyles.doneRow}>
          <Text style={eventStyles.timestamp}>
            {new Date(event.ts).toLocaleTimeString()}
          </Text>
          <View
            style={[
              eventStyles.doneBadge,
              {
                backgroundColor:
                  event.outcome === "success" ? "#10b981" : "#ef4444",
              },
            ]}
          >
            <Text style={eventStyles.doneBadgeText}>
              {event.outcome === "success"
                ? "完成"
                : event.outcome === "cancelled"
                ? "已取消"
                : event.outcome === "max_turns"
                ? "达到最大轮次"
                : "失败"}
            </Text>
          </View>
          {event.result && (
            <Text style={eventStyles.doneResult}>{event.result}</Text>
          )}
          {event.usage && (
            <View style={eventStyles.usageRow}>
              {event.usage.inputTokens != null && (
                <Text style={eventStyles.usageText}>
                  输入: {event.usage.inputTokens} tokens
                </Text>
              )}
              {event.usage.outputTokens != null && (
                <Text style={eventStyles.usageText}>
                  输出: {event.usage.outputTokens} tokens
                </Text>
              )}
              {event.usage.totalCostUsd != null && (
                <Text style={eventStyles.usageText}>
                  费用: ${event.usage.totalCostUsd.toFixed(4)}
                </Text>
              )}
            </View>
          )}
        </View>
      );

    default:
      return null;
  }
}

export default function RunPage({ route, navigation }: RunPageProps) {
  const { runId } = route.params;
  const { runs, jobs, agents } = useTaskStore();
  const { connectionState } = useDeviceStore();
  const scrollViewRef = useRef<ScrollView>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const isConnected = connectionState === "connected";

  // 获取当前 run
  const run = runs.find((r) => r.id === runId);
  // 获取该 run 下的所有 jobs
  const runJobs = jobs.filter((j) => j.runId === runId);
  // 计算总事件数（用于触发滚动）
  const totalEvents = runJobs.reduce((sum, j) => sum + j.events.length, 0);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && totalEvents > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [totalEvents, autoScroll]);

  // 取消任务
  const handleCancel = () => {
    if (!run) return;
    Alert.alert("确认取消", "确定要取消这个任务吗？", [
      { text: "返回", style: "cancel" },
      {
        text: "取消任务",
        style: "destructive",
        onPress: () => {
          connectionService.sendControlCommand("cancel", run.taskId, "task");
        },
      },
    ]);
  };

  // 页面标题
  useEffect(() => {
    navigation.setOptions({
      title: run?.taskTitle || "运行详情",
      headerStyle: { backgroundColor: colors.bg },
      headerTintColor: "#fff",
    });
  }, [navigation, run?.taskTitle]);

  if (!run) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>🔍</Text>
        <Text style={styles.emptyText}>未找到运行记录</Text>
        <Text style={styles.emptySubtext}>ID: {runId}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 顶部状态栏 */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: getStatusColor(run.status) },
            ]}
          />
          <Text style={styles.statusLabel}>{getStatusLabel(run.status)}</Text>
        </View>

        <View style={styles.statusRight}>
          {run.status === "running" && isConnected && (
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>取消</Text>
            </TouchableOpacity>
          )}
          {run.status === "running" && (
            <ActivityIndicator
              size="small"
              color="#f59e0b"
              style={{ marginLeft: 8 }}
            />
          )}
        </View>
      </View>

      {/* 运行信息 */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>任务</Text>
          <Text style={styles.infoValue}>{run.taskTitle || "-"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>模式</Text>
          <Text style={styles.infoValue}>{run.mode}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>开始时间</Text>
          <Text style={styles.infoValue}>
            {new Date(run.startedAt).toLocaleString()}
          </Text>
        </View>
        {run.endedAt && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>结束时间</Text>
            <Text style={styles.infoValue}>
              {new Date(run.endedAt).toLocaleString()}
            </Text>
          </View>
        )}
      </View>

      {/* 最终输出 */}
      {run.finalResult && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>最终输出</Text>
          <Text style={styles.resultText}>{run.finalResult}</Text>
        </View>
      )}

      {run.error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>错误</Text>
          <Text style={styles.errorText}>{run.error}</Text>
        </View>
      )}

      {/* Job 列表和事件 */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.eventsContainer}
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          const isAtBottom =
            layoutMeasurement.height + contentOffset.y >=
            contentSize.height - 50;
          setAutoScroll(isAtBottom);
        }}
        scrollEventThrottle={200}
      >
        {runJobs.length === 0 ? (
          <View style={styles.noJobsContainer}>
            <Text style={styles.noJobsText}>
              {run.status === "running"
                ? "等待 Agent 响应..."
                : "暂无执行记录"}
            </Text>
          </View>
        ) : (
          runJobs.map((job) => (
            <View key={job.id} style={styles.jobCard}>
              {/* Job 头部 */}
              <View style={styles.jobHeader}>
                <Text style={styles.jobAgentName}>
                  {job.agentName || `Agent ${job.agentId.slice(0, 8)}`}
                </Text>
                <View
                  style={[
                    styles.jobStatusBadge,
                    { backgroundColor: getStatusColor(job.status) },
                  ]}
                >
                  <Text style={styles.jobStatusText}>{job.status}</Text>
                </View>
              </View>

              {/* Job prompt */}
              {job.prompt && (
                <View style={styles.jobPromptContainer}>
                  <Text style={styles.jobPromptLabel}>Prompt:</Text>
                  <Text style={styles.jobPromptText} numberOfLines={3}>
                    {job.prompt}
                  </Text>
                </View>
              )}

              {/* 事件列表 */}
              {job.events.length > 0 && (
                <View style={styles.eventsList}>
                  {job.events.map((event, idx) => renderEvent(event, idx))}
                </View>
              )}

              {/* Job 结果 */}
              {job.result && (
                <View style={styles.jobResultContainer}>
                  <Text style={styles.jobResultLabel}>结果:</Text>
                  <Text style={styles.jobResultText}>{job.result}</Text>
                </View>
              )}

              {/* Job usage */}
              {job.usage && (
                <View style={styles.jobUsageContainer}>
                  {job.usage.inputTokens != null && (
                    <Text style={styles.jobUsageText}>
                      输入: {job.usage.inputTokens}
                    </Text>
                  )}
                  {job.usage.outputTokens != null && (
                    <Text style={styles.jobUsageText}>
                      输出: {job.usage.outputTokens}
                    </Text>
                  )}
                  {job.usage.totalCostUsd != null && (
                    <Text style={styles.jobUsageText}>
                      费用: ${job.usage.totalCostUsd.toFixed(4)}
                    </Text>
                  )}
                </View>
              )}
            </View>
          ))
        )}

        {/* 底部间距 */}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* 底部自动滚动提示 */}
      {!autoScroll && run.status === "running" && (
        <TouchableOpacity
          style={styles.scrollToBottomButton}
          onPress={() => {
            scrollViewRef.current?.scrollToEnd({ animated: true });
            setAutoScroll(true);
          }}
        >
          <Text style={styles.scrollToBottomText}>滚动到底部</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtext: {
    color: colors.textFaint,
    fontSize: 14,
  },
  statusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  statusRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "#ef4444",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  cancelButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
  },
  infoCard: {
    backgroundColor: colors.surface,
    margin: 12,
    borderRadius: 10,
    padding: 14,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  infoLabel: {
    color: colors.textMuted,
    fontSize: 13,
  },
  infoValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
    textAlign: "right",
  },
  resultCard: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#10b981",
  },
  resultTitle: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  resultText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  errorCard: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  errorTitle: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 14,
    lineHeight: 20,
  },
  eventsContainer: {
    flex: 1,
  },
  noJobsContainer: {
    padding: 40,
    alignItems: "center",
  },
  noJobsText: {
    color: colors.textFaint,
    fontSize: 14,
  },
  jobCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 10,
    padding: 14,
  },
  jobHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  jobAgentName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  jobStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  jobStatusText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "500",
  },
  jobPromptContainer: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
  },
  jobPromptLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 4,
  },
  jobPromptText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  eventsList: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  jobResultContainer: {
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    borderRadius: 6,
    padding: 10,
    marginTop: 10,
  },
  jobResultLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "500",
    marginBottom: 4,
  },
  jobResultText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  jobUsageContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
    gap: 12,
  },
  jobUsageText: {
    color: colors.textFaint,
    fontSize: 11,
  },
  scrollToBottomButton: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  scrollToBottomText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "500",
  },
});

const eventStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    flexWrap: "wrap",
  },
  timestamp: {
    color: colors.textFaint,
    fontSize: 11,
    width: 70,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    marginRight: 6,
  },
  badgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "500",
  },
  detail: {
    color: colors.textMuted,
    fontSize: 12,
    flex: 1,
  },
  outputRow: {
    flexDirection: "row",
    marginBottom: 4,
    flexWrap: "wrap",
  },
  outputPrefix: {
    color: "#a78bfa",
    fontSize: 12,
    fontWeight: "500",
  },
  outputText: {
    color: "#e5e7eb",
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  toolRow: {
    backgroundColor: "rgba(99, 102, 241, 0.08)",
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  toolBadge: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  toolBadgeText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "500",
  },
  toolName: {
    color: "#a5b4fc",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4,
  },
  toolInput: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 16,
  },
  toolResultRow: {
    backgroundColor: "rgba(16, 185, 129, 0.06)",
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  toolResultBadge: {
    backgroundColor: "#10b981",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  toolResultBadgeText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "500",
  },
  toolOutput: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 16,
  },
  errorRow: {
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    flex: 1,
  },
  doneRow: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  doneBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: "flex-start",
    marginBottom: 6,
  },
  doneBadgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
  },
  doneResult: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  usageRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 6,
    gap: 12,
  },
  usageText: {
    color: colors.textFaint,
    fontSize: 11,
  },
});
