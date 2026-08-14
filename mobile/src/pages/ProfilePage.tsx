/**
 * 个人信息（二级页）
 * 展示头像 / 昵称 / 用户名 / 用户 ID，可修改昵称、上传头像。
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
  Alert,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api, type UserInfo } from "../services/api";
import { Avatar } from "../components/Avatar";
import { colors, spacing, radius, fontSize } from "../theme";

export default function ProfilePage() {
  const [me, setMe] = useState<UserInfo | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showAvatarViewer, setShowAvatarViewer] = useState(false);

  useEffect(() => {
    void api.getMe().then((r) => {
      if (r.data) {
        setMe(r.data);
        setDisplayName(r.data.displayName || "");
      }
    });
  }, []);

  const pickAndUploadAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("需要相册权限"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    setUploadingAvatar(true);
    try {
      const res = await api.uploadAvatar(result.assets[0].base64, result.assets[0].mimeType ?? "image/jpeg");
      if (res.error) { setMsg(res.error); return; }
      setMe((prev) => prev ? { ...prev, avatarUrl: res.data!.url } : prev);
      setMsg("头像已更新");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploadingAvatar(false);
    }
  };

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
        <TouchableOpacity onPress={() => setShowAvatarViewer(true)} disabled={uploadingAvatar} activeOpacity={0.8}>
          <Avatar name={me?.displayName || me?.username || "?"} avatarUrl={me?.avatarUrl} size={84} />
        </TouchableOpacity>
        <TouchableOpacity onPress={pickAndUploadAvatar} disabled={uploadingAvatar} activeOpacity={0.8} style={styles.avatarEditBadge}>
          {uploadingAvatar ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="camera" size={14} color="#fff" />
          )}
        </TouchableOpacity>
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

      {/* 全屏头像查看 */}
      <Modal transparent visible={showAvatarViewer} animationType="fade" onRequestClose={() => setShowAvatarViewer(false)}>
        <View style={styles.avatarViewerOverlay}>
          <TouchableOpacity style={styles.avatarViewerClose} onPress={() => setShowAvatarViewer(false)} hitSlop={10}>
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          <Avatar name={me?.displayName || me?.username || "?"} avatarUrl={me?.avatarUrl} size={280} />
          <TouchableOpacity style={styles.avatarViewerBtn} onPress={() => { setShowAvatarViewer(false); pickAndUploadAvatar(); }} activeOpacity={0.8}>
            <Ionicons name="camera" size={20} color="#fff" />
            <Text style={styles.avatarViewerBtnText}>更换头像</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  avatarWrap: { alignItems: "center", marginTop: spacing.xl },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
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
  // 全屏头像查看
  avatarViewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarViewerClose: { position: "absolute", top: 50, right: 20, zIndex: 10 },
  avatarViewerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
  },
  avatarViewerBtnText: { color: "#fff", fontSize: fontSize.md, fontWeight: "600" },
});
