/**
 * 语音消息录制组件（参考 box-im ChatRecord.vue）
 * 使用 expo-av 录音，支持开始/暂停/继续/重录/发送
 */
import React, { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "../services/api";
import { colors, spacing, radius, fontSize } from "../theme";

interface VoiceRecorderProps {
  onSend: (url: string, duration: number) => void;
  onCancel: () => void;
}

export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [status, setStatus] = useState<"idle" | "recording" | "paused">("idle");
  const [duration, setDuration] = useState(0);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // 脉冲动画
  useEffect(() => {
    if (status === "recording") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [status, pulseAnim]);

  // 计时器
  useEffect(() => {
    if (status === "recording") {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status]);

  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(recording);
      setDuration(0);
      setStatus("recording");
    } catch (err) {
      console.error("录音启动失败:", err);
    }
  };

  const pauseRecording = async () => {
    if (!recording) return;
    await recording.pauseAsync();
    setStatus("paused");
  };

  const resumeRecording = async () => {
    if (!recording) return;
    await recording.startAsync();
    setStatus("recording");
  };

  const stopRecording = async () => {
    if (!recording) return;
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    const uri = recording.getURI();
    setRecording(null);
    setStatus("idle");
    return uri;
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const uri = await stopRecording();
      if (!uri) return;
      // 读取文件为 base64
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const res = await api.uploadAttachment({ name: "voice.m4a", mime: "audio/m4a", data: base64 });
      if (!res.error && res.data) {
        onSend(res.data.url, duration);
      }
    } catch (err) {
      console.error("发送语音失败:", err);
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async () => {
    await stopRecording();
    onCancel();
  };

  const handleReset = async () => {
    await stopRecording();
    setDuration(0);
    startRecording();
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // 自动开始录音
  useEffect(() => {
    void startRecording();
  }, []);

  return (
    <View style={styles.container}>
      {/* 取消按钮 */}
      <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
        <Text style={styles.cancelText}>取消</Text>
      </TouchableOpacity>

      {/* 录音状态指示 */}
      <View style={styles.center}>
        <Animated.View style={[styles.pulse, { transform: [{ scale: pulseAnim }] }]}>
          <View style={[styles.dot, status === "recording" ? styles.dotActive : styles.dotPaused]} />
        </Animated.View>
        <Text style={styles.duration}>{formatDuration(duration)}</Text>
        <Text style={styles.statusText}>{status === "recording" ? "录音中…" : status === "paused" ? "已暂停" : "准备中"}</Text>
      </View>

      {/* 操作按钮 */}
      <View style={styles.actions}>
        {status === "recording" ? (
          <TouchableOpacity style={styles.actionBtn} onPress={pauseRecording} activeOpacity={0.7}>
            <Ionicons name="pause" size={28} color={colors.primary} />
          </TouchableOpacity>
        ) : status === "paused" ? (
          <TouchableOpacity style={styles.actionBtn} onPress={resumeRecording} activeOpacity={0.7}>
            <Ionicons name="play" size={28} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        {status !== "idle" && (
          <TouchableOpacity style={styles.actionBtn} onPress={handleReset} activeOpacity={0.7}>
            <Ionicons name="refresh" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        {status !== "idle" && (
          <TouchableOpacity
            style={[styles.sendBtn, sending && { opacity: 0.6 }]}
            onPress={handleSend}
            disabled={sending}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelBtn: { padding: spacing.sm },
  cancelText: { color: colors.textMuted, fontSize: fontSize.md },
  center: { alignItems: "center", flex: 1 },
  pulse: { marginBottom: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotActive: { backgroundColor: colors.danger },
  dotPaused: { backgroundColor: colors.warning },
  duration: { color: colors.text, fontSize: fontSize.xl, fontWeight: "700" },
  statusText: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.md },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
