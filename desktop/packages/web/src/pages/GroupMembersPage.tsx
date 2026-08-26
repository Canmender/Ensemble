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
import { normalizeRole, ROLE_LEVEL, type OrgRole } from "@ensemble/shared";

const ROLE_LABELS: Record<OrgRole, string> = { owner: "群主", admin: "管理员", moderator: "协管", member: "成员", guest: "访客" };
const ROLE_COLORS: Record<OrgRole, string> = {
  owner: "bg-amber-500/15 text-amber-600", admin: "bg-blue-500/15 text-blue-600",
  moderator: "bg-emerald-500/15 text-emerald-600", member: "bg-muted/15 text-muted", guest: "bg-muted/15 text-muted",
};
const ROLE_ICONS: Record<OrgRole, typeof Crown> = { owner: Crown, admin: Shield, moderator: Shield, member: UserIcon, guest: UserIcon };

interface MemberInfo {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: string;
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

  async function setRole(userId: string, role: string) {
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

  const sorted = [...members].sort((a, b) => ROLE_LEVEL[normalizeRole(b.role)] - ROLE_LEVEL[normalizeRole(a.role)]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> 返回
      </button>
      <h1 className="mb-4 text-lg font-bold text-fg">群成员（{members.length}）</h1>

      {loading ? <Spinner /> : sorted.map((m) => {
        const role = normalizeRole(m.role);
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
            {isOwnerOrAdmin && role !== "owner" && (
              <div className="flex gap-1">
                <button onClick={() => void setRole(m.userId, "admin")} className="rounded p-1 text-muted hover:text-fg" title="设为管理员"><Shield className="h-3.5 w-3.5" /></button>
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
              void api.post(`/groups/${convId}/members/${u.id}/role`, { role: "3" }).then(() => { showToast("已邀请"); setShowInvite(false); });
            }}>邀请</Button>
          </div>
        ))}
      </Modal>
    </div>
  );
}
