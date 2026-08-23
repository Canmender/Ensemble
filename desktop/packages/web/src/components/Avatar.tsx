import { useEffect, useState } from "react";
import { cls } from "./ui";
import { getCloudBase, isMultiMode } from "../lib/apiBase";

/**
 * 头像 URL 解析：服务端存的是相对路径（/uploads/avatars/...）。
 * multi 模式下页面 origin ≠ 云端 API origin，裸相对路径会 404——
 * 按 cloudBase 拼成绝对地址；本地模式（同源）原样返回。
 */
function useResolvedAvatarUrl(avatarUrl: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(avatarUrl);
  useEffect(() => {
    setResolved(avatarUrl);
    if (!avatarUrl || !avatarUrl.startsWith("/") || !isMultiMode()) return;
    let cancelled = false;
    void getCloudBase().then((base) => {
      if (!cancelled && base) setResolved(`${base}${avatarUrl}`);
    });
    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);
  return resolved;
}

/** 圆形头像：有 avatarUrl 显示图片（multi 模式自动拼云端基址），否则显示首字符的彩色圆块。 */
export function Avatar({
  name,
  avatarUrl,
  size = 36,
  className,
}: { name?: string; avatarUrl?: string; size?: number; className?: string }) {
  const src = useResolvedAvatarUrl(avatarUrl);
  const label = (name || "?")[0]?.toUpperCase();
  if (src) {
    return (
      <img
        src={src}
        alt={name || "avatar"}
        width={size}
        height={size}
        className={cls("rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const hue = (Array.from((name || "?")).reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
  return (
    <span
      className={cls("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: `hsl(${hue} 60% 48%)`, fontSize: size * 0.42 }}
    >
      {label}
    </span>
  );
}
