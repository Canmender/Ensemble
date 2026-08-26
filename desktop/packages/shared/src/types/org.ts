/**
 * 组织角色（O1 团队权限基础）
 * owner > admin > moderator > member > guest
 * 现有值 'user' 读时归一化为 'member'（不刷库）
 */
export type OrgRole = "owner" | "admin" | "moderator" | "member" | "guest";

/** 存量角色归一化：旧值 'user' 映射为 'member'（不破坏现有登录） */
export function normalizeRole(role: string | undefined): OrgRole {
  if (role === "user" || role === "member") return "member";
  return (["owner", "admin", "moderator", "member", "guest"] as OrgRole[]).includes(role as OrgRole)
    ? (role as OrgRole)
    : "member";
}

/** 角色排序（owner=5 最高；用于权限比较：操作者只能授予 ≤ 自身等级的角色） */
export const ROLE_LEVEL: Record<OrgRole, number> = {
  owner: 5,
  admin: 4,
  moderator: 3,
  member: 2,
  guest: 1,
};
