/**
 * 隐私设置页：参考 V-IM 的 7 项隐私开关
 */
import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, Switch, ScrollView, Alert } from "react-native";
import { api } from "../services/api";
import { colors, spacing, fontSize } from "../theme";

interface PrivacySettings {
  allowAddFriend: boolean;
  requireFriendApproval: boolean;
  allowPrivateChat: boolean;
  voiceReminder: boolean;
  showPhone: boolean;
  showEmail: boolean;
}

export default function PrivacySettingsPage() {
  const [settings, setSettings] = useState<PrivacySettings>({
    allowAddFriend: true,
    requireFriendApproval: false,
    allowPrivateChat: true,
    voiceReminder: true,
    showPhone: false,
    showEmail: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api.getPrivacy().then((r) => {
      if (r.data) setSettings(r.data);
      setLoading(false);
    });
  }, []);

  const updateSetting = async (key: keyof PrivacySettings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    const res = await api.updatePrivacy({ [key]: value });
    if (res.error) {
      Alert.alert("保存失败", res.error);
      setSettings((prev) => ({ ...prev, [key]: !value }));
    }
  };

  const items: Array<{ key: keyof PrivacySettings; label: string; desc: string }> = [
    { key: "allowAddFriend", label: "允许被添加好友", desc: "关闭后他人无法向你发送好友请求" },
    { key: "requireFriendApproval", label: "好友验证", desc: "添加好友时需要你审核通过" },
    { key: "allowPrivateChat", label: "允许私聊", desc: "关闭后非好友无法与你私聊" },
    { key: "voiceReminder", label: "消息语音提醒", desc: "收到新消息时播放提示音" },
    { key: "showPhone", label: "展示手机号", desc: "其他用户可在你的资料页看到手机号" },
    { key: "showEmail", label: "展示邮箱", desc: "其他用户可在你的资料页看到邮箱" },
  ];

  return (
    <ScrollView style={styles.container}>
      {items.map((item) => (
        <View key={item.key} style={styles.row}>
          <View style={styles.rowInfo}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.desc}>{item.desc}</Text>
          </View>
          <Switch
            value={settings[item.key]}
            onValueChange={(v) => updateSetting(item.key, v)}
            trackColor={{ false: colors.surfaceAlt, true: colors.primarySoft }}
            thumbColor={settings[item.key] ? colors.primary : colors.textFaint}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowInfo: { flex: 1, marginRight: spacing.md },
  label: { color: colors.text, fontSize: fontSize.md, fontWeight: "500" },
  desc: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
});
