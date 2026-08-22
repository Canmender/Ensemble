/**
 * 表情选择面板：常用 emoji 分类 + 最近使用 + 自定义表情包
 * 点击表情直接发送，长按预览
 */
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Dimensions, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, fontSize } from "../theme";

const RECENT_KEY = "emoji_recent";
const CUSTOM_KEY = "emoji_custom";
const MAX_RECENT = 20;
const COLS = 8;
const ITEM_SIZE = (Dimensions.get("window").width - spacing.lg * 2) / COLS;

/** 常用 emoji 分类 */
const EMOJI_CATEGORIES: { name: string; icon?: string; emojis: string[] }[] = [
  {
    name: "常用",
    icon: "time-outline",
    emojis: [],
  },
  {
    name: "笑脸",
    icon: "happy-outline",
    emojis: ["😀", "😂", "🥹", "😍", "🥰", "😎", "🤔", "😅", "😭", "😤", "🥺", "😱", "🙄", "😴", "🤮", "🤩", "😏", "😬", "🤗", "😜", "🤪", "😇", "🥳", "🫡"],
  },
  {
    name: "手势",
    icon: "hand-left-outline",
    emojis: ["👍", "👎", "👏", "🙏", "🤝", "✌️", "🤞", "🤟", "👌", "👋", "💪", "🫶", "🤙", "✋", "🖐️", "☝️", "🫰", "🤌", "👈", "👉", "👆", "👇"],
  },
  {
    name: "爱心",
    icon: "heart-outline",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❤️‍🔥", "💕", "💞", "💓", "💗", "💖", "💝", "💘", "💟", "♥️", "🩷", "🩵", "🩶"],
  },
  {
    name: "动物",
    icon: "paw-outline",
    emojis: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦅", "🦋", "🐛", "🐝"],
  },
  {
    name: "食物",
    icon: "restaurant-outline",
    emojis: ["🍎", "🍕", "🍔", "🍟", "🌮", "🍣", "🍜", "🍰", "🍩", "🍪", "🍫", "☕", "🍺", "🥤", "🧋", "🍿", "🍦", "🎂", "🍰", "🧁", "🥐", "🍳"],
  },
  {
    name: "其他",
    icon: "star-outline",
    emojis: ["🎉", "🎊", "🎈", "🎁", "🏆", "⚽", "🏀", "🎵", "🎬", "📱", "💻", "⏰", "💡", "🔥", "⭐", "🌈", "☀️", "🌙", "⚡", "💧", "🌊", "❄️"],
  },
  {
    name: "自定义",
    icon: "add-circle-outline",
    emojis: [],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onSend?: (emoji: string) => void;
  directSend?: boolean;
}

export function EmojiPicker({ onSelect, onSend, directSend = false }: EmojiPickerProps) {
  const [recent, setRecent] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState(1);

  useEffect(() => {
    void AsyncStorage.getItem(RECENT_KEY).then((v) => {
      if (v) setRecent(JSON.parse(v));
    });
    void AsyncStorage.getItem(CUSTOM_KEY).then((v) => {
      if (v) setCustom(JSON.parse(v));
    });
  }, []);

  const handleSelect = useCallback(
    (emoji: string) => {
      if (directSend && onSend) {
        onSend(emoji);
      } else {
        onSelect(emoji);
      }
      setRecent((prev) => {
        const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
        void AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
        return next;
      });
    },
    [onSelect, onSend, directSend],
  );

  const handleAddCustom = useCallback(() => {
    Alert.prompt?.(
      "添加自定义表情",
      "输入 emoji 或表情符号:",
      (text) => {
        if (text?.trim()) {
          setCustom((prev) => {
            const next = [text.trim(), ...prev.filter((e) => e !== text.trim())];
            void AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
            return next;
          });
        }
      },
    ) ?? Alert.alert("添加自定义表情", "长按已有表情可删除");
  }, []);

  const handleRemoveCustom = useCallback((emoji: string) => {
    Alert.alert("删除表情", "确定删除这个自定义表情?", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          setCustom((prev) => {
            const next = prev.filter((e) => e !== emoji);
            void AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
            return next;
          });
        },
      },
    ]);
  }, []);

  const categories = [
    { name: "常用", icon: "time-outline", emojis: recent },
    ...EMOJI_CATEGORIES.slice(1, -1),
    { name: "自定义", icon: "add-circle-outline", emojis: custom },
  ];

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
            <Ionicons
              name={(cat.icon as any) || "happy-outline"}
              size={18}
              color={i === activeTab ? colors.primary : colors.textMuted}
            />
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
            onLongPress={() => activeTab === categories.length - 1 && handleRemoveCustom(item)}
            activeOpacity={0.6}
          >
            <Text style={styles.emoji}>{item}</Text>
          </TouchableOpacity>
        )}
        ListFooterComponent={
          activeTab === categories.length - 1 ? (
            <TouchableOpacity style={styles.addBtn} onPress={handleAddCustom}>
              <Ionicons name="add" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null
        }
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
    justifyContent: "space-around",
  },
  tab: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  tabActive: { backgroundColor: colors.primarySoft },
  grid: { paddingHorizontal: spacing.sm },
  emojiItem: {
    width: ITEM_SIZE,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 24 },
  addBtn: {
    width: ITEM_SIZE,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    margin: 4,
    borderStyle: "dashed",
  },
});
