/**
 * 通用 UI 组件（移动端设计系统）
 * Screen / Card / Button / Input / ListItem / Badge / EmptyState / SectionHeader
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, radius, fontSize } from "../theme";

/* ── Screen ─────────────────────────────────────────────────────────── */

export function Screen({
  children,
  scroll,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (scroll) {
    return (
      <SafeAreaView style={[styles.screen, style]}>
        <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return <SafeAreaView style={[styles.screen, style]}>{children}</SafeAreaView>;
}

/* ── Card ───────────────────────────────────────────────────────────── */

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const card = <View style={[styles.card, style]}>{children}</View>;
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        {card}
      </TouchableOpacity>
    );
  }
  return card;
}

/* ── Button ─────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "ghost" | "danger";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    variant === "primary" ? colors.primary : variant === "danger" ? colors.danger : "transparent";
  const textColor = variant === "ghost" ? colors.textMuted : "#fff";
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.button,
        { backgroundColor: bg },
        variant === "ghost" && styles.buttonGhost,
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "ghost" ? colors.textMuted : "#fff"} />
      ) : (
        <Text style={[styles.buttonText, { color: textColor }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

/* ── Input ──────────────────────────────────────────────────────────── */

export function Input({
  value,
  onChangeText,
  placeholder,
  multiline,
  secureTextEntry,
  autoFocus,
  style,
  maxLength,
  editable,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  autoFocus?: boolean;
  style?: StyleProp<TextStyle>;
  maxLength?: number;
  editable?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textFaint}
      multiline={multiline}
      secureTextEntry={secureTextEntry}
      autoFocus={autoFocus}
      maxLength={maxLength}
      editable={editable}
      style={[styles.input, multiline && styles.inputMultiline, style]}
    />
  );
}

/* ── ListItem ───────────────────────────────────────────────────────── */

export function ListItem({
  icon,
  title,
  subtitle,
  right,
  onPress,
  style,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const content = (
    <View style={[styles.listItem, style]}>
      {icon && <View style={styles.listItemIcon}>{icon}</View>}
      <View style={styles.listItemBody}>
        <Text style={styles.listItemTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={styles.listItemSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

/* ── Badge ──────────────────────────────────────────────────────────── */

export function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

/* ── EmptyState ─────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.empty}>
      {icon && <View style={styles.emptyIcon}>{icon}</View>}
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle && <Text style={styles.emptySubtitle}>{subtitle}</Text>}
    </View>
  );
}

/* ── SectionHeader ──────────────────────────────────────────────────── */

export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

/* ── Styles ─────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  button: {
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonGhost: { borderWidth: 1, borderColor: colors.border },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: fontSize.md, fontWeight: "600" },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    minHeight: 46,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  listItemIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  listItemBody: { flex: 1, marginRight: spacing.sm },
  listItemTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: "600" },
  listItemSubtitle: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 48, paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600", marginBottom: spacing.xs },
  emptySubtitle: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: "center", lineHeight: 20 },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
});
