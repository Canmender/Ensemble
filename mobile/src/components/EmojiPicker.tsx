/**
 * 表情选择面板：常用 emoji 分类 + 最近使用（AsyncStorage 持久化）
 * 参考 box-im/V-IM 的表情面板设计。
 */
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Dimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, radius, fontSize } from "../theme";

const RECENT_KEY = "emoji_recent";
const MAX_RECENT = 20;
const COLS = 8;
const ITEM_SIZE = (Dimensions.get("window").width - spacing.lg * 2) / COLS;

/** 常用 emoji 分类 */
const EMOJI_CATEGORIES: { name: string; emojis: string[] }[] = [
  {
    name: "常用",
    emojis: ["😀", "😂", "🥹", "😍", "🥰", "😎", "🤔", "😅", "😭", "😤", "🥺", "😱", "🙄", "😴", "🤮", "🤩"],
  },
  {
    name: "手势",
    emojis: ["👍", "👎", "👏", "🙏", "🤝", "✌️", "🤞", "🤟", "👌", "👋", "💪", "🫶", "🤙", "✋", "🖐️", "☝️"],
  },
  {
    name: "爱心",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❤️‍🔥", "💕", "💞", "💓", "💗", "💖", "💝"],
  },
  {
    name: "动物",
    emojis: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔"],
  },
  {
    name: "食物",
    emojis: ["🍎", "🍕", "🍔", "🍟", "🌮", "🍣", "🍜", "🍰", "🍩", "🍪", "🍫", "☕", "🍺", "🥤", "🧋", "🍿"],
  },
  {
    name: "其他",
    emojis: ["🎉", "🎊", "🎈", "🎁", "🏆", "⚽", "🏀", "🎵", "🎬", "📱", "💻", "⏰", "💡", "🔥", "⭐", "🌈"],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [recent, setRecent] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    void AsyncStorage.getItem(RECENT_KEY).then((v) => {
      if (v) setRecent(JSON.parse(v));
    });
  }, []);

  const handleSelect = useCallback(
    (emoji: string) => {
      onSelect(emoji);
      // 更新最近使用
      setRecent((prev) => {
        const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
        void AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
        return next;
      });
    },
    [onSelect],
  );

  const categories = recent.length > 0
    ? [{ name: "最近", emojis: recent }, ...EMOJI_CATEGORIES]
    : EMOJI_CATEGORIES;

  const currentEmojis = categories[activeTab]?.emojis ?? [];

  return (
    <View style={styles.container}>
      {/* 分类标签 */}
      <View style={styles.tabs}>
        {categories.map((cat, i) => (
          <TouchableOpacity
            key={cat.name}
            style={[styles.tab, i === activeTab && styles.tabActive]}
            onPress={() => setActiveTab(i)}
          >
            <Text style={[styles.tabText, i === activeTab && styles.tabTextActive]}>{cat.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {/* emoji 网格 */}
      <FlatList
        data={currentEmojis}
        numColumns={COLS}
        keyExtractor={(item, idx) => `${item}-${idx}`}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.emojiItem}
            onPress={() => handleSelect(item)}
            activeOpacity={0.6}
          >
            <Text style={styles.emoji}>{item}</Text>
          </TouchableOpacity>
        )}
        style={styles.grid}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: 260,
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  tabActive: { backgroundColor: colors.primarySoft },
  tabText: { color: colors.textMuted, fontSize: fontSize.xs },
  tabTextActive: { color: colors.primary, fontWeight: "600" },
  grid: { paddingHorizontal: spacing.sm },
  emojiItem: {
    width: ITEM_SIZE,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 24 },
});
