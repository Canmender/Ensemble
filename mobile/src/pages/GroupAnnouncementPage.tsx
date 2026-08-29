/**
 * 群公告页
 * GET /api/conversations/:convId — 获取公告
 * PUT /api/groups/:convId/announcement — 编辑公告
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRoute } from "@react-navigation/native";
import { api } from "../services/api";
import { useMeStore } from "../store/meStore";
import { colors, spacing, radius, fontSize, elevation } from "../theme";
import { LiquidGlass } from "../components/Glass";

export default function GroupAnnouncementPage() {
  const route = useRoute<any>();
  const convId = route.params?.convId;
  const me = useMeStore((s) => s.me);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const myRole = me?.role || "member";
  const canEdit = myRole === "owner" || myRole === "admin";

  const loadAnnouncement = useCallback(async () => {
    if (!convId) return;
    try {
      const data = await api.get<{ announcement?: string }>(`/conversations/${convId}`);
      const announcement = data.announcement || "";
      setContent(announcement);
      setOriginal(announcement);
    } catch (e) {
      console.error("加载公告失败:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [convId]);

  useEffect(() => {
    void loadAnnouncement();
  }, [loadAnnouncement]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadAnnouncement();
  }, [loadAnnouncement]);

  const handleSave = async () => {
    if (!content.trim() || content === original) return;

    setSaving(true);
    try {
      await api.put(`/groups/${convId}/announcement`, { text: content.trim() });
      setOriginal(content.trim());
      Alert.alert("成功", "公告已更新");
    } catch (e) {
      Alert.alert("错误", (e as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.header}>群公告</Text>

      <View style={styles.card}>
        <LiquidGlass blur={20} style={styles.cardGlass} />
        <View style={styles.cardContent}>
          {canEdit ? (
            <>
              <TextInput
                style={styles.textArea}
                placeholder="输入群公告内容（支持 Markdown）..."
                placeholderTextColor={colors.textFaint}
                value={content}
                onChangeText={setContent}
                multiline
                numberOfLines={8}
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.saveBtn, (saving || content === original) && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving || content === original}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                )}
                <Text style={styles.saveBtnText}>{saving ? "保存中..." : "保存"}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.contentView}>
              {content ? (
                <Text style={styles.contentText}>{content}</Text>
              ) : (
                <Text style={styles.emptyText}>暂无公告</Text>
              )}
            </View>
          )}
        </View>
      </View>

      {!canEdit && (
        <View style={styles.hintContainer}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textFaint} />
          <Text style={styles.hintText}>只有群主和管理员可以编辑公告</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  contentContainer: { padding: spacing.lg, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  header: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text, marginBottom: spacing.lg },
  card: { borderRadius: radius.lg, overflow: "hidden", ...elevation.md },
  cardGlass: { ...StyleSheet.absoluteFillObject },
  cardContent: { padding: spacing.lg, position: "relative", minHeight: 200 },
  textArea: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 150,
    marginBottom: spacing.md,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: fontSize.md, fontWeight: "600", color: "#fff" },
  contentView: { minHeight: 150 },
  contentText: { fontSize: fontSize.md, color: colors.text, lineHeight: 24 },
  emptyText: { fontSize: fontSize.md, color: colors.textFaint, fontStyle: "italic" },
  hintContainer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md },
  hintText: { fontSize: fontSize.sm, color: colors.textFaint },
});
