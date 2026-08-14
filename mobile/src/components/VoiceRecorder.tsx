/**
 * 语音消息录制组件（参考 box-im ChatRecord.vue）
 * 使用 expo-audio 录音（expo-av 已从 SDK 57 移除），支持开始/暂停/继续/重录/发送
 */
import React, { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "../services/api";
import { colors, spacing, radius, fontSize } from "../theme";

interface VoiceRecorderProps {
  onSend: (url: string, duration: number) => void;
  onCancel: () => void;
}

export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [status, setStatus] = useState<"idle" | "recording" | "paused">("idle");
  const [sending, setSending] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 500);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const duration = Math.floor(recState.durationMillis / 1000);

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

  const startRecording = async () => {
    try {
      await requestRecordingPermissionsAsync();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!recState.canRecord) {
        await recorder.prepareToRecordAsync();
      }
      recorder.record();
      setStatus("recording");
    } catch (err) {
      console.error("录音启动失败:", err);
    }
  };

  const pauseRecording = () => {
    recorder.pause();
    setStatus("paused");
  };

  const resumeRecording = () => {
    recorder.record();
    setStatus("recording");
  };

  const stopRecording = async () => {
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch (err) {
      console.error("停止录音失败:", err);
    }
    setStatus("idle");
  };

  const handleSend = async () => {
    setSending(true);
    try {
      await stopRecording();
      const uri = recorder.uri;
      if (!uri) return;
      // 读取文件为 base64
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const res = await api.uploadAttachment({ name: "voice.m4a", mime: "audio/m4a", data: base64 });
      if (!res.error && res.data) {
        onSend(res.data.url, Math.max(1, Math.round(recorder.currentTime || duration)));
      }
    } catch (err) {
      console.error("发送语音失败:", err);
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async () => {
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch (err) {
      console.error("取消录音失败:", err);
    }
    onCancel();
  };

  const handleReset = async () => {
    try {
      await recorder.stop();
    } catch (err) {
      console.error("重录失败:", err);
    }
    setStatus("idle");
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
    return () => {
      try {
        if (recorder.isRecording) void recorder.stop();
      } catch (err) {
        console.error("卸载清理失败:", err);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
