/**
 * 个人信息（二级页）
 * 展示昵称 / 用户名 / 用户 ID，可修改昵称（保存到服务器）。
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { api, type UserInfo } from "../services/api";
import { colors, spacing, radius, fontSize } from "../theme";

export default function ProfilePage() {
  const [me, setMe] = useState<UserInfo | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void api.getMe().then((r) => {
      if (r.data) {
        setMe(r.data);
        setDisplayName(r.data.displayName || "");
      }
    });
  }, []);

  const save = async () => {
    if (!displayName.trim()) {
      setMsg("昵称不能为空");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await api.updateProfile(displayName.trim());
      if (res.error) {
        setMsg(res.error);
      } else {
        setMsg("已保存");
        setMe((m) => (m ? { ...m, displayName: res.data?.displayName } : m));
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {me?.displayName?.[0] || me?.username?.[0]?.toUpperCase() || "?"}
          </Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.label}>昵称</Text>
          <Text style={styles.value}>{me?.displayName || "未设置"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>用户名</Text>
          <Text style={styles.value}>@{me?.username}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>用户 ID</Text>
          <Text style={[styles.value, styles.idValue]} numberOfLines={1}>
            {me?.id}
          </Text>
        </View>
      </View>

      <View style={styles.editCard}>
        <Text style={styles.editLabel}>修改昵称</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="输入新昵称"
          placeholderTextColor={colors.textFaint}
          maxLength={30}
        />
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={() => void save()}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>保存</Text>}
        </TouchableOpacity>
        {msg && <Text style={[styles.msg, msg === "已保存" && styles.msgOk]}>{msg}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  avatarWrap: { alignItems: "center", marginTop: spacing.xl },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontSize: 32, fontWeight: "700" },
  infoCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  label: { color: colors.textMuted, fontSize: fontSize.sm },
  value: { color: colors.text, fontSize: fontSize.sm, maxWidth: "65%" },
  idValue: { fontSize: 11 },
  editCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  editLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: "600", marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: fontSize.md,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: 12,
    alignItems: "center",
    marginTop: spacing.md,
  },
  saveBtnText: { color: "#fff", fontSize: fontSize.md, fontWeight: "600" },
  msg: { color: colors.danger, fontSize: fontSize.xs, marginTop: spacing.sm, textAlign: "center" },
  msgOk: { color: colors.success },
});
