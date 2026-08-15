/**
 * 语音消息气泡：点击播放/暂停（expo-audio）
 * 显示播放进度条 + 时长；消息内容 [语音 Xs] 解析出初始时长，加载后以真实时长为准
 */
import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { colors, spacing, fontSize } from "../theme";

interface VoiceMessageProps {
  url: string;
  isUser: boolean;
  durationText?: string;
}

/** 从 "[语音 12s]" 解析秒数 */
function parseVoiceSeconds(content?: string): number {
  if (!content) return 0;
  const m = content.match(/(\d+)\s*s/);
  return m ? Math.max(1, parseInt(m[1], 10)) : 0;
}

export function VoiceMessage({ url, isUser, durationText }: VoiceMessageProps) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const [restart, setRestart] = useState(false);

  useEffect(() => {
    if (status.didJustFinish) setRestart(true);
  }, [status.didJustFinish]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
    } else {
      if (restart || status.currentTime >= (status.duration || 0)) {
        void player.seekTo(0);
        setRestart(false);
      }
      player.play();
    }
  };

  const duration = status.duration > 0 && !Number.isNaN(status.duration)
    ? Math.round(status.duration)
    : parseVoiceSeconds(durationText);
  const progress = status.duration > 0
    ? Math.min(100, (status.currentTime / status.duration) * 100)
    : 0;

  return (
    <TouchableOpacity style={styles.row} onPress={toggle} activeOpacity={0.75}>
      <Ionicons
        name={status.playing ? "pause-circle" : "play-circle"}
        size={26}
        color={isUser ? "#fff" : colors.primary}
      />
      <View style={styles.wave}>
        <View style={[styles.track, isUser ? styles.trackUser : styles.trackOther]}>
          <View
            style={[
              styles.fill,
              { width: `${progress}%` },
              isUser ? styles.fillUser : styles.fillOther,
            ]}
          />
        </View>
      </View>
      <Text style={[styles.duration, isUser ? styles.durationUser : styles.durationOther]}>
        {duration}″
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 120,
    maxWidth: 180,
    paddingVertical: 2,
  },
  wave: { flex: 1 },
  track: { height: 4, borderRadius: 2, overflow: "hidden", opacity: 0.5 },
  trackUser: { backgroundColor: "rgba(255,255,255,0.5)" },
  trackOther: { backgroundColor: "rgba(0,0,0,0.15)" },
  fill: { height: 4, borderRadius: 2 },
  fillUser: { backgroundColor: "#fff" },
  fillOther: { backgroundColor: colors.primary },
  duration: { fontSize: fontSize.xs, fontWeight: "600", minWidth: 28, textAlign: "right" },
  durationUser: { color: "rgba(255,255,255,0.9)" },
  durationOther: { color: colors.textMuted },
});
