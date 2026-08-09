/**
 * Agent 列表页面
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from "react-native";
import { useTaskStore } from "../store/taskStore";
import { useDeviceStore } from "../store/deviceStore";
import type { AgentConfig } from "@ensemble/shared-protocol";

export default function AgentsPage() {
  const { agents } = useTaskStore();
  const { connectionState } = useDeviceStore();

  const isConnected = connectionState === "connected";

  // Agent 类型图标
  const getAgentIcon = (kind: string) => {
    switch (kind) {
      case "builtin":
        return "🤖";
      case "local":
        return "💻";
      default:
        return "🔧";
    }
  };

  // 渲染 Agent 项
  const renderAgentItem = ({ item }: { item: AgentConfig }) => {
    return (
      <TouchableOpacity style={styles.agentItem}>
        <View style={styles.agentHeader}>
          <Text style={styles.agentIcon}>{getAgentIcon(item.kind)}</Text>
          <View style={styles.agentInfo}>
            <Text style={styles.agentName}>{item.name}</Text>
            <Text style={styles.agentKind}>
              {item.kind === "builtin" ? "内置 Agent" : "本地 Agent"}
            </Text>
          </View>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: item.enabled ? "#10b981" : "#6b7280" },
            ]}
          />
        </View>

        {item.description && (
          <Text style={styles.agentDescription} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        <View style={styles.agentMeta}>
          <Text style={styles.agentModel}>{item.model}</Text>
          <Text style={styles.agentProvider}>{item.providerId}</Text>
        </View>

        <View style={styles.agentTools}>
          {item.tools.slice(0, 3).map((tool, index) => (
            <View key={index} style={styles.toolBadge}>
              <Text style={styles.toolText}>{tool}</Text>
            </View>
          ))}
          {item.tools.length > 3 && (
            <Text style={styles.moreTools}>+{item.tools.length - 3}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* 头部 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Agent 列表</Text>
        <Text style={styles.headerSubtitle}>
          {isConnected ? `${agents.length} 个 Agent` : "未连接"}
        </Text>
      </View>

      {/* Agent 列表 */}
      {!isConnected ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🔌</Text>
          <Text style={styles.emptyText}>未连接到桌面端</Text>
          <Text style={styles.emptySubtext}>
            请先在看板页面连接到桌面端
          </Text>
        </View>
      ) : agents.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🤖</Text>
          <Text style={styles.emptyText}>暂无 Agent</Text>
          <Text style={styles.emptySubtext}>
            请在桌面端创建 Agent
          </Text>
        </View>
      ) : (
        <FlatList
          data={agents}
          renderItem={renderAgentItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111827",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
  },
  headerSubtitle: {
    color: "#9ca3af",
    fontSize: 14,
  },
  listContent: {
    padding: 16,
  },
  agentItem: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  agentHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  agentIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  agentInfo: {
    flex: 1,
  },
  agentName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  agentKind: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 2,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  agentDescription: {
    color: "#d1d5db",
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },
  agentMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  agentModel: {
    color: "#10b981",
    fontSize: 12,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  agentProvider: {
    color: "#6b7280",
    fontSize: 12,
  },
  agentTools: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
  },
  toolBadge: {
    backgroundColor: "#374151",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  toolText: {
    color: "#9ca3af",
    fontSize: 11,
  },
  moreTools: {
    color: "#6b7280",
    fontSize: 11,
    alignSelf: "center",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtext: {
    color: "#6b7280",
    textAlign: "center",
  },
});
