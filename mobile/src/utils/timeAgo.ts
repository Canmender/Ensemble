/**
 * 相对时间格式化（刚刚 / 5分钟前 / 昨天 / 3天前 / 03/15）
 */
export function timeAgo(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day}天前`;
  // 超过 7 天显示日期
  const m = d.getMonth() + 1;
  const dayOfMonth = d.getDate();
  const year = d.getFullYear();
  return year === new Date().getFullYear()
    ? `${String(m).padStart(2, "0")}/${String(dayOfMonth).padStart(2, "0")}`
    : `${year}/${String(m).padStart(2, "0")}/${String(dayOfMonth).padStart(2, "0")}`;
}
