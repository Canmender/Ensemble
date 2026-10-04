/**
 * 群成员列表页（P0）：头像 + 昵称 + 角色标签 + 邀请入口
 * GET /api/conversations/:convId/members — 返回 [{userId, role, status, joinedAt}]
 * PUT /api/groups/:convId/members/:userId/role — 修改角色（仅群主/管理员）
 * POST /api/groups/:convId/members/:userId/kick — 踢人（群主：所有人；管理员：成员）
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Crown, Shield, User as UserIcon, UserPlus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Avatar } from "../components/Avatar";
import { Button, Card, Modal, Input, Spinner, cls, showToast } from "../components/ui";
// normalizeRole / ROLE_LEVEL 用于「当前登录用户的组织角色」（users 表的字符串 role），
// 与下面的群成员数字角色是两套语义，不可混用。
import { normalizeRole, ROLE_LEVEL } from "@ensemble/shared";
/**
 * 群成员角色是**数字** 1=群主 2=管理员 3=普通成员（见服务端
 * groups.ts 与 store.listGroupMembers），与 @ensemble/shared 的 OrgRole
 * 字符串体系（owner/admin/moderator/member/guest）是两套不同语义。
 * 此处原先误用 normalizeRole 解析数字，导致数字全部退化为 "member"：
 * 所有人显示「成员」、且 `role !== "owner"` 恒真（人人可踢人）。
 */
type GroupRole = 1 | 2 | 3;
const ROLE_LABELS: Record<GroupRole, string> = { 1: "群主", 2: "管理员", 3: "成员" };
const ROLE_COLORS: Record<GroupRole, string> = {
  1: "bg-amber-500/15 text-amber-600", 2: "bg-blue-500/15 text-blue-600", 3: "bg-muted/15 text-muted",
};
const ROLE_ICONS: Record<GroupRole, typeof Crown> = { 1: Crown, 2: Shield, 3: UserIcon };

interface MemberInfo {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: 1 | 2 | 3;
  joinedAt: string;
}

export default function GroupMembersPage() {
  const navigate = useNavigate();
  const { state } = useAuth();
  const convId = new URLSearchParams(window.location.search).get("convId") ?? "";
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteResults, setInviteResults] = useState<Array<{ id: string; username: string; displayName?: string }>>([]);

  const myRole = normalizeRole(state.user?.role ?? "member");
  const isOwnerOrAdmin = ROLE_LEVEL[myRole] >= ROLE_LEVEL.admin;

  useEffect(() => {
    if (!convId) return;
    setLoading(true);
    api.get<MemberInfo[]>(`/conversations/${convId}/members`)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [convId]);

  async function searchInvite(q: string) {
    setInviteQuery(q);
    if (!q.trim()) { setInviteResults([]); return; }
    setInviteResults(await api.get(`/users/search?q=${encodeURIComponent(q)}&limit=20`));
  }

  /**
   * 改角色。role 必须是数字 1|2|3 —— 服务端 groups.ts:72 强校验
   * `typeof role !== "number"`，传字符串必定 400。
   */
  async function setRole(userId: string, role: 1 | 2 | 3) {
    try {
      await api.patch(`/groups/${convId}/members/${userId}/role`, { role });
      setMembers((ms) => ms.map((m) => m.userId === userId ? { ...m, role } : m));
      showToast("已更新角色");
    } catch (e) { showToast((e as Error).message, "error"); }
  }

  async function kick(userId: string) {
    if (!confirm("确定踢出该成员？")) return;
    try {
      await api.post(`/groups/${convId}/members/${userId}/kick`);
      setMembers((ms) => ms.filter((m) => m.userId !== userId));
      showToast("已踢出");
    } catch (e) { showToast((e as Error).message, "error"); }
  }

  const sorted = [...members].sort((a, b) => a.role - b.role);

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> 返回
      </button>
      <h1 className="mb-4 text-lg font-bold text-fg">群成员（{members.length}）</h1>

      {loading ? <Spinner /> : sorted.map((m) => {
        const role = m.role as GroupRole;
        const RoleIcon = ROLE_ICONS[role];
        return (
          <Card key={m.userId} className="mb-2 flex items-center gap-3 px-4 py-3">
            <Avatar name={m.displayName || m.username} avatarUrl={m.avatarUrl} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{m.displayName || m.username}</div>
              <div className="text-xs text-muted">@{m.username}</div>
            </div>
            <span className={cls("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", ROLE_COLORS[role])}>
              <RoleIcon className="h-3 w-3" /> {ROLE_LABELS[role]}
            </span>
            {isOwnerOrAdmin && role !== 1 && (
              <div className="flex gap-1">
                <button onClick={() => void setRole(m.userId, 2)} className="rounded p-1 text-muted hover:text-fg" title="设为管理员"><Shield className="h-3.5 w-3.5" /></button>
                <button onClick={() => void kick(m.userId)} className="rounded p-1 text-muted hover:text-destructive" title="踢出"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            )}
          </Card>
        );
      })}

      {isOwnerOrAdmin && (
        <Button variant="secondary" className="mt-4 w-full" onClick={() => setShowInvite(true)}>
          <UserPlus className="h-4 w-4 mr-2" /> 邀请成员
        </Button>
      )}

      <Modal open={showInvite} onClose={() => { setShowInvite(false); setInviteQuery(""); setInviteResults([]); }} title="邀请成员">
        <Input value={inviteQuery} onChange={(e) => void searchInvite(e.target.value)} placeholder="搜索用户名…" autoFocus className="mb-3" />
        {inviteResults.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-3 py-2 rounded hover:bg-muted/10">
            <span className="text-sm text-fg">{u.displayName || u.username}</span>
            <Button variant="secondary" className="text-xs px-2 py-0.5" onClick={() => {
              void setRole(u.id, 3).then(() => { showToast("已邀请"); setShowInvite(false); });
            }}>邀请</Button>
          </div>
        ))}
      </Modal>
    </div>
  );
}
