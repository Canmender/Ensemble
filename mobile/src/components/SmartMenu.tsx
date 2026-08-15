/**
 * 智能定位长按菜单（参考 box-im long-press-menu）
 * - 根据触摸位置智能判断菜单位置（上半屏/下半屏）
 * - 滑动取消
 * - 动画过渡
 */
import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  PanResponder,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, fontSize } from "../theme";
import { Glass } from "./Glass";

const SCREEN_H = Dimensions.get("window").height;
const MENU_HEIGHT = 200; // 估算菜单高度

interface MenuItem {
  icon: string;
  label: string;
  color?: string;
  onPress: () => void;
}

interface SmartMenuProps {
  visible: boolean;
  items: MenuItem[];
  onClose: () => void;
  /** 触摸位置 Y（用于智能定位） */
  touchY?: number;
}

export function SmartMenu({ visible, items, onClose, touchY }: SmartMenuProps) {
  const slideY = useRef(0);

  // 根据触摸位置决定菜单在上方还是下方
  const isAbove = touchY ? touchY > SCREEN_H / 2 : false;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        slideY.current = gestureState.dy;
      },
      onPanResponderRelease: (_, gestureState) => {
        // 向上/下滑超过 50px 关闭菜单
        if (Math.abs(gestureState.dy) > 50) {
          onClose();
        }
        slideY.current = 0;
      },
    }),
  ).current;

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <Glass
          intensity={50}
          style={[
            styles.menu,
            isAbove ? styles.menuAbove : styles.menuBelow,
          ]}
        >
          <View {...panResponder.panHandlers}>
          {items.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.menuItem, i < items.length - 1 && styles.menuItemBorder]}
              onPress={() => { item.onPress(); onClose(); }}
              activeOpacity={0.7}
            >
              <Ionicons name={item.icon as any} size={20} color={item.color || colors.text} />
              <Text style={[styles.menuText, item.color && { color: item.color }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.menuItem, styles.menuItemBorder]} onPress={onClose} activeOpacity={0.7}>
            <Text style={[styles.menuText, styles.menuCancel]}>取消</Text>
          </TouchableOpacity>
          </View>
        </Glass>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  menu: {
    backgroundColor: "transparent",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
  },
  menuAbove: {
    position: "absolute",
    top: spacing.xxl,
    left: 0,
    right: 0,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  menuBelow: {},
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuText: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  menuCancel: { color: colors.textMuted, textAlign: "center" },
});
