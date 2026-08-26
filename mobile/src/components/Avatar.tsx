/**
 * 通用头像组件：优先显示网络头像，无头像时显示名字首字（按名字 hash 算背景色）
 */
import React, { useMemo } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { useDeviceStore } from "../store/deviceStore";
import { colors, radius , ms } from "../theme";

const AVATAR_COLORS = [
  "#3B3F4A", "#8F7D6F", "#6E5F52", "#5F7A5A", "#7E6B5E", "#897F75",
];

interface AvatarProps {
  name: string;
  avatarUrl?: string;
  size?: number;
}

/** 名字 hash → 背景色索引 */
function nameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/** 补全头像 URL（服务器返回相对路径） */
function fullUrl(u?: string): string | undefined {
  if (!u) return undefined;
  if (u.startsWith("http")) return u;
  const d = useDeviceStore.getState().connectedDevice;
  return d ? `http://${d.ip}:${d.httpPort}${u}` : u;
}

export function Avatar({ name, avatarUrl, size = 40 }: AvatarProps) {
  const url = useMemo(() => fullUrl(avatarUrl), [avatarUrl]);
  const initial = (name || "?")[0];
  const bg = useMemo(() => nameColor(name), [name]);
  const fontSize = size * 0.42;

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}>
      {url ? (
        <Image source={{ uri: url }} style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[styles.fallback, { backgroundColor: bg, width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.initial, { fontSize }]}>{initial}</Text>
        </View>
      )}
    </View>
  );
}

const styles = ms({
  container: { overflow: "hidden" },
  image: {},
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { color: "#fff", fontWeight: "700" },
});
