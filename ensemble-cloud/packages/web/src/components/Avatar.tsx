import { cls } from "./ui";

/** 圆形头像：有 avatarUrl 显示图片，否则显示首字符的彩色圆块。 */
export function Avatar({
  name,
  avatarUrl,
  size = 36,
  className,
}: { name?: string; avatarUrl?: string; size?: number; className?: string }) {
  const label = (name || "?")[0]?.toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
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
