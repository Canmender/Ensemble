/**
 * 语音发送（按住说话）：按住录音、松手发送、上滑取消
 * 使用 expo-audio 录音；时长下限 1s、上限 60s（到时自动停发）
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, PanResponder, Animated, ActivityIndicator } from "react-native";
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
import { colors, spacing, fontSize } from "../theme";

interface VoiceRecorderProps {
  onSend: (url: string, duration: number) => void;
  onCancel: () => void;
}

const MIN_SECONDS = 1;
const MAX_SECONDS = 60;
const CANCEL_OFFSET = -72; // 上滑超过此距离松手=取消

export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 200);
  const [recording, setRecording] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [slideY] = useState(() => new Animated.Value(0));
  const cancelRef = useRef(false);
  const activeRef = useRef(false); // 当前是否在录制
  const finishedRef = useRef(false); // 本次会话是否已完成（防重入）

  const duration = Math.round(recState.durationMillis / 1000);

  useEffect(() => {
    // 到时自动停止并发送
    if (recording && duration >= MAX_SECONDS) {
      void finishRecording(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, recording]);

  const startRecording = async () => {
    if (sending) return;
    try {
      await requestRecordingPermissionsAsync();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      activeRef.current = true;
      finishedRef.current = false;
      cancelRef.current = false;
      setRecording(true);
      setCancelArmed(false);
    } catch (err) {
      console.error("录音启动失败:", err);
      setRecording(false);
    }
  };

  const finishRecording = async (doSend: boolean) => {
    if (finishedRef.current) return;
    if (!activeRef.current && !doSend) return;
    finishedRef.current = true;
    activeRef.current = false;
    setRecording(false);
    setCancelArmed(false);
    slideY.setValue(0);
    const dur = Math.max(1, Math.round(recState.durationMillis / 1000));
    const cancelled = cancelRef.current;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      /* 幂等 */
    }
    if (!doSend || cancelled || dur < MIN_SECONDS) {
      onCancel();
      return;
    }
    setSending(true);
    try {
      const uri = recorder.uri;
      if (!uri) { onCancel(); setSending(false); return; }
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const res = await api.uploadAttachment({ name: "voice.m4a", mime: "audio/m4a", data: base64 });
      if (!res.error && res.data) {
        onSend(res.data.url, dur);
      } else {
        onCancel();
      }
    } catch (err) {
      console.error("发送语音失败:", err);
      onCancel();
    } finally {
      setSending(false);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => activeRef.current,
      onPanResponderGrant: () => {
        void startRecording();
      },
      onPanResponderMove: (_, g) => {
        if (!activeRef.current) return;
        const delta = Math.max(0, -g.dy);
        slideY.setValue(delta);
        setCancelArmed(delta >= -CANCEL_OFFSET);
      },
      onPanResponderRelease: (_, g) => {
        if (!activeRef.current) return;
        cancelRef.current = g.dy < CANCEL_OFFSET;
        void finishRecording(!cancelRef.current);
      },
      onPanResponderTerminate: () => {
        if (!activeRef.current) return;
        cancelRef.current = true;
        void finishRecording(false);
      },
    }),
  ).current;

  return (
    <View style={styles.wrap}>
      {sending ? (
        <View style={styles.bigBtn}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <View style={styles.holdArea}>
          <Animated.View
            style={{ transform: [{ translateY: slideY }], alignSelf: "stretch" }}
            {...panResponder.panHandlers}
          >
            <View style={[styles.bigBtn, recording && styles.bigBtnActive, cancelArmed && styles.bigBtnCancel]}>
              <Ionicons name="mic" size={30} color={cancelArmed ? "#fff" : colors.primary} />
              <Text style={[styles.bigBtnText, cancelArmed && styles.bigBtnTextCancel]}>
                {cancelArmed ? "松开取消" : recording ? `正在录音… ${duration}s` : "按住 说话"}
              </Text>
            </View>
          </Animated.View>
          <Text style={styles.hintText}>
            {recording ? (cancelArmed ? "上滑松手取消" : "松手发送，上滑取消") : "按住录音 · 松手发送 · 上滑取消"}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  holdArea: { paddingHorizontal: spacing.lg },
  bigBtn: {
    width: "100%",
    height: 44,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  bigBtnActive: { backgroundColor: colors.primarySoft },
  bigBtnCancel: { backgroundColor: colors.danger, borderColor: colors.danger },
  bigBtnText: { color: colors.primary, fontSize: fontSize.md, fontWeight: "600" },
  bigBtnTextCancel: { color: "#fff" },
  hintText: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: "center", marginTop: spacing.sm },
});