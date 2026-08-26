/**
 * 设备互联页（L1-L2，手机桌面互联方案）：
 * - 输入 6 位配对码（桌面端设置页显示）→ 完成配对
 * - 配对列表：已配对桌面设备 + 解除配对
 * - sinceTs 补拉入口（配对后 sync.request/sync.delta 在 relay 链路上跑通）
 *
 * 设计：与现有 DeviceRemotePage 共存——
 * DeviceRemotePage 是手动 relay 遥控（填 URL+Key），本页是官方配对流程。
 * 后续可合并为一个统一入口，本期独立实现避免互相影响。
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../services/api";
import { useDeviceStore } from "../store/deviceStore";
import { colors, spacing, radius, fontSize, elevation, ms } from "../theme";
import { useMeStore } from "../store/meStore";

interface PairedDevice {
  id: string;
  userId: string;
  desktopDeviceId: string;
  mobileDeviceId: string;
  pairedAt: number;
}

/** 生成简单的设备 ID（用于配对请求） */
function getDeviceId(): string {
  const stored = useDeviceStore.getState().currentDevice?.id;
  if (stored) return stored;
  // 生成并持久化一个随机 ID
  const id = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  useDeviceStore.setState({ currentDevice: { id, name: "手机端", type: "mobile" } });
  return id;
}

export default function DeviceLinkPage() {
  const insets = useSafeAreaInsets();
  const me = useMeStore((s) => s.me);

  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairs, setPairs] = useState<PairedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPairs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPairs();
      if (res.data) {
        setPairs(res.data);
        setError(null);
      } else {
        setError(res.error ?? "加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPairs();
  }, [loadPairs]);

  const handlePair = useCallback(async () => {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      Alert.alert("配对码错误", "请输入桌面端显示的 6 位数字配对码");
      return;
    }
    setPairing(true);
    setError(null);
    try {
      const deviceId = getDeviceId();
      const res = await api.confirmPair(trimmed, deviceId);
      if (res.data?.pairId) {
        Alert.alert("配对成功", "已与桌面设备建立安全连接");
        setCode("");
        await loadPairs();
      } else {
        setError(res.error ?? "配对失败，请检查配对码是否正确或已过期");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setPairing(false);
    }
  }, [code, loadPairs]);

  const handleRemove = useCallback((pair: PairedDevice) => {
    Alert.alert(
      "解除配对",
      `确定要解除与桌面设备 (${pair.desktopDeviceId}) 的配对吗？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "解除",
          style: "destructive",
          onPress: async () => {
            const res = await api.removePair(pair.id);
            if (res.data?.removed) {
              await loadPairs();
            } else {
              Alert.alert("解除失败", res.error ?? "请重试");
            }
          },
        },
      ],
    );
  }, [loadPairs]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* 配对码输入区 */}
      <View style={styles.inputSection}>
        <View style={styles.iconWrap}>
          <Ionicons name="keypad-outline" size={28} color={colors.primary} />
        </View>
        <Text style={styles.inputTitle}>输入配对码</Text>
        <Text style={styles.inputDesc}>在桌面端「设置 → 设备互联」查看 6 位配对码</Text>
        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
          placeholder="000000"
          placeholderTextColor={colors.textFaint}
          keyboardType="number-pad"
          maxLength={6}
          editable={!pairing}
        />
        <TouchableOpacity
          style={[styles.pairBtn, (!code || code.length < 6 || pairing) && styles.pairBtnDisabled]}
          onPress={() => void handlePair()}
          disabled={!code || code.length < 6 || pairing}
        >
          {pairing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.pairBtnText}>开始配对</Text>
          )}
        </TouchableOpacity>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      {/* 已配对设备列表 */}
      <View style={styles.listSection}>
        <Text style={styles.listTitle}>已配对设备</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : pairs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="laptop-outline" size={40} color={colors.textFaint} />
            <Text style={styles.emptyText}>暂无已配对设备</Text>
            <Text style={styles.emptyDesc}>输入配对码与桌面端建立安全连接</Text>
          </View>
        ) : (
          pairs.map((p) => (
            <View key={p.id} style={styles.pairCard}>
              <View style={styles.pairInfo}>
                <Ionicons name="laptop-outline" size={24} color={colors.primary} />
                <View style={styles.pairText}>
                  <Text style={styles.pairDeviceId} numberOfLines={1}>
                    {p.desktopDeviceId}
                  </Text>
                  <Text style={styles.pairTime}>配对于 {formatTime(p.pairedAt)}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => handleRemove(p)}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {/* 说明区 */}
      <View style={styles.helpSection}>
        <Text style={styles.helpTitle}>配对说明</Text>
        <Text style={styles.helpItem}>1. 在桌面端「设置 → 设备互联」生成配对码</Text>
        <Text style={styles.helpItem}>2. 在上方输入 6 位配对码并点击「开始配对」</Text>
        <Text style={styles.helpItem}>3. 配对成功后，双端可通过中继服务器安全同步数据</Text>
        <Text style={styles.helpItem}>4. 配对码 5 分钟内有效，过期需重新生成</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 96 },
  inputSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    elevation: elevation.sm,
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: radius.md,
    backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center",
    marginBottom: spacing.md,
  },
  inputTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: "700", marginBottom: spacing.xs },
  inputDesc: { color: colors.textMuted, fontSize: fontSize.sm, marginBottom: spacing.lg, textAlign: "center" },
  codeInput: {
    width: 200, height: 56, borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt, textAlign: "center",
    fontSize: 28, fontWeight: "700", letterSpacing: 8,
    color: colors.text, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  pairBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    paddingHorizontal: spacing.xl, paddingVertical: 12, minWidth: 160, alignItems: "center",
  },
  pairBtnDisabled: { opacity: 0.5 },
  pairBtnText: { color: colors.primaryFg, fontSize: fontSize.sm, fontWeight: "700" },
  errorText: { color: colors.danger, fontSize: fontSize.xs, marginTop: spacing.md },

  listSection: { marginBottom: spacing.lg },
  listTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: "700", marginBottom: spacing.md },
  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, alignItems: "center",
    paddingVertical: 32, gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  emptyText: { color: colors.text, fontSize: fontSize.sm, fontWeight: "600" },
  emptyDesc: { color: colors.textFaint, fontSize: fontSize.xs },

  pairCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    flexDirection: "row", alignItems: "center", marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  pairInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  pairText: { flex: 1 },
  pairDeviceId: { color: colors.text, fontSize: fontSize.sm, fontWeight: "600" },
  pairTime: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 2 },
  removeBtn: { padding: spacing.xs },

  helpSection: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  helpTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: "700", marginBottom: spacing.sm },
  helpItem: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 18, marginBottom: 4 },
});
