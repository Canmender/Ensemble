/**
 * 语音消息气泡：点击播放/暂停（expo-audio）
 * - 气泡宽度按时长自适应（时长越长越宽，范围 84px ~ 200px）
 * - 播放中显示波纹动画 + 进度条
 * - 消息内容 [语音 Xs] 解析初始时长，加载后以真实时长为准
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { colors, spacing, fontSize , ms } from "../theme";

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

/** 气泡宽度按时长自适应（84 ~ 200px，0s 取最小） */
function widthForSeconds(s: number): number {
  if (s <= 0) return 84;
  return Math.min(200, Math.max(84, 84 + s * 4));
}

export function VoiceMessage({ url, isUser, durationText }: VoiceMessageProps) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const [restart, setRestart] = useState(false);
  const waveAnim = useRef(new Animated.Value(0)).current;

  const duration = status.duration > 0 && !Number.isNaN(status.duration)
    ? Math.round(status.duration)
    : parseVoiceSeconds(durationText);
  const bubbleWidth = widthForSeconds(duration);
  const progress = status.duration > 0
    ? Math.min(100, (status.currentTime / status.duration) * 100)
    : 0;

  // 播放中波纹动画
  useEffect(() => {
    if (status.playing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim, { toValue: 1.4, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(waveAnim, { toValue: 0.8, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    waveAnim.setValue(0.8);
  }, [status.playing, waveAnim]);

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

  return (
    <TouchableOpacity style={[styles.row, { width: bubbleWidth, maxWidth: 200 }]} onPress={toggle} activeOpacity={0.75}>
      <Ionicons
        name={status.playing ? "pause-circle" : "play-circle"}
        size={26}
        color={isUser ? "#fff" : colors.primary}
      />
      <View style={styles.waveWrap}>
        {/* 波纹（播放中动画） */}
        <View style={styles.wave}>
          {[0, 1, 2, 3].map((i) => (
            <Animated.View
              key={i}
              style={[
                styles.pill,
                { opacity: 0.6 + i * 0.1 },
                status.playing && { transform: [{ scaleY: waveAnim }] },
                isUser ? styles.pillUser : styles.pillOther,
              ]}
            />
          ))}
        </View>
        {/* 进度条 */}
        <View style={[styles.track, isUser ? styles.trackUser : styles.trackOther]}>
          <View style={[styles.fill, { width: `${progress}%` }, isUser ? styles.fillUser : styles.fillOther]} />
        </View>
      </View>
      <Text style={[styles.duration, isUser ? styles.durationUser : styles.durationOther]}>
        {duration}″
      </Text>
    </TouchableOpacity>
  );
}

const styles = ms({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 84,
    paddingVertical: 4,
  },
  waveWrap: { flex: 1 },
  wave: {
    flexDirection: "row",
    alignItems: "center",
    height: 18,
    gap: 2,
  },
  pill: { width: 3, height: 16, borderRadius: 2, backgroundColor: colors.primary },
  pillUser: { backgroundColor: "rgba(255,255,255,0.9)" },
  pillOther: { backgroundColor: colors.primary },
  track: { height: 3, borderRadius: 1.5, overflow: "hidden", marginTop: 1, opacity: 0.5 },
  trackUser: { backgroundColor: "rgba(255,255,255,0.5)" },
  trackOther: { backgroundColor: "rgba(0,0,0,0.15)" },
  fill: { height: 3, borderRadius: 1.5 },
  fillUser: { backgroundColor: "#fff" },
  fillOther: { backgroundColor: colors.primary },
  duration: { fontSize: fontSize.xs, fontWeight: "600", minWidth: 28, textAlign: "right" },
  durationUser: { color: "rgba(255,255,255,0.9)" },
  durationOther: { color: colors.textMuted },
});