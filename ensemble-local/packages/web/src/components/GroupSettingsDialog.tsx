import { useCallback, useEffect, useMemo, useState } from "react";
import { Info, ShieldCheck, Trash2, UserX, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Input, Textarea, Label, Spinner, Modal, showToast, cls } from "./ui";
import { Avatar } from "./Avatar";

/** 会话详情（后端 GET /conversations/:id 返回） */
interface GroupDetail {
  id: string;
  type: "direct" | "group";
  title?: string;
  participantIds: string[];
  announcement?: string;
  groupMuted?: boolean;
  groupOwner?: string;
  groupAdmins?: string[];
  userId?: string;
  runId: string;
}

interface NameRef { id: string; name: string; avatarUrl?: string }

/**
 * 群聊管理弹窗。
 * 权限模型与后端一致：
 * - 群主：改名/公告/禁言/增删成员/设置管理员/解散群
 * - 管理员：改名/公告/禁言/增删成员（不可踢群主、不可改管理员）
 * - 普通成员：只读
 */
export function GroupSettingsDialog({
  convId,
  onClose,
  onChanged,
}: {
  convId: string;
  onClose: () => void;
  onChanged?: (detail: GroupDetail) => void;
}) {
  const { state: authState } = useAuth();
  const me = authState.user;
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [agents, setAgents] = useState<NameRef[]>([]);
  const [users, setUsers] = useState<NameRef[]>([]);
  const [name, setName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [muted, setMuted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [busyAdminId, setBusyAdminId] = useState<string | null>(null);
  const [toDissolve, setToDissolve] = useState(false);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) map.set(u.id, u.name);
    for (const a of agents) map.set(a.id, a.name);
    return map;
  }, [users, agents]);

  const isOwner = !!me && detail?.groupOwner === me.id;
  const isAdmin = useMemo(() => {
    if (!me || !detail) return false;
    if (detail.groupOwner === me.id) return true;
    return Array.isArray(detail.groupAdmins) && detail.groupAdmins.includes(me.id);
  }, [me, detail]);
  const canModerate = isOwner || isAdmin;

  // 加载候选 Agent 与用户（用于名称解析 / 添加成员）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [aRes, uRes] = await Promise.all([
        api.get<Array<{ id: string; name: string }>>("/agents").catch(() => []),
        api.get<Array<{ id: string; displayName?: string; username?: string; avatarUrl?: string }>>("/auth/users").catch(() => []),
      ]);
      if (cancelled) return;
      setAgents(aRes ?? []);
      setUsers((uRes ?? []).map((u) => ({ id: u.id, name: u.displayName || u.username || u.id, avatarUrl: u.avatarUrl })));
    })();
    return () => { cancelled = true; };
  }, []);

  const loadDetail = useCallback(async () => {
    try {
      const d = await api.get<GroupDetail>(`/conversations/${convId}`);
      setDetail(d);
      setName(d.title ?? "");
      setAnnouncement(d.announcement ?? "");
      setMuted(!!d.groupMuted);
    } catch (e) {
      showToast("加载群设置失败: " + (e as Error).message, "error");
      onClose();
    }
  }, [convId, onClose]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  /** 保存群名 / 公告 / 禁言 */
  async function saveInfo() {
    if (!detail) return;
    const patch: Record<string, unknown> = {};
    if (name !== detail.title) patch.title = name;
    if (announcement !== (detail.announcement ?? "")) patch.announcement = announcement;
    if (muted !== !!detail.groupMuted) patch.groupMuted = muted;
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      await api.patch(`/conversations/${convId}`, patch);
      showToast("群设置已保存");
      await loadDetail();
    } catch (e) {
      showToast("保存失败: " + (e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  /** 添加成员 */
  async function addMember(id: string) {
    if (!detail) return;
    const next = Array.from(new Set([...(detail.participantIds ?? []), id]));
    try {
      await api.patch(`/conversations/${convId}`, { participantIds: next });
      showToast("已添加成员");
      await loadDetail();
    } catch (e) {
      showToast("添加失败: " + (e as Error).message, "error");
    }
  }

  if (!detail) {
    return (
      <Modal open onClose={onClose} title="群聊设置">
        <div className="flex h-40 items-center justify-center"><Spinner /></div>
      </Modal>
    );
  }

  const memberIds = detail.participantIds ?? [];
  const ownerLabel = detail.groupOwner ? (nameById.get(detail.groupOwner) ?? detail.groupOwner) : undefined;
  const showChatName = (pid: string) => {
    if (detail.groupOwner === pid) return "群主";
    return Array.isArray(detail.groupAdmins) && detail.groupAdmins.includes(pid) ? "管理员" : isUser(pid) ? "成员" : "智能体";
  };

  return (
    <Modal open onClose={onClose} title={`群聊设置 · ${detail.title ?? "群聊"}`}>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        {/* 群信息 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Info className="h-4 w-4 text-muted" /> 群信息</div>
          <div>
            <Label>群名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canModerate} placeholder="群名称" />
          </div>
          <div>
            <Label>群公告</Label>
            <Textarea value={announcement} onChange={(e) => setAnnouncement(e.target.value)} disabled={!canModerate} placeholder="群公告内容" rows={3} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span className="text-sm text-fg">全体禁言</span>
            <button
              type="button"
              disabled={!canModerate}
              onClick={() => setMuted((m) => !m)}
              className={cls("relative h-5 w-9 rounded-full transition-colors", muted ? "bg-primary" : "bg-muted/40", !canModerate && "cursor-not-allowed opacity-50")}
              aria-label="全体禁言"
            >
              <span className={cls("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", muted ? "left-[18px]" : "left-0.5")} />
            </button>
          </div>
          {canModerate && (
            <div className="flex justify-end">
              <Button onClick={() => void saveInfo()} disabled={saving}>{saving ? <Spinner /> : "保存"}</Button>
            </div>
          )}
        </div>

        {/* 权限说明 */}
        <div className="space-y-2 rounded-lg bg-muted/10 p-3 text-xs text-muted">
          <div><span className="font-medium text-fg">群主：</span>{ownerLabel ?? "—"}</div>
          <div><span className="font-medium text-fg">管理员：</span>{(detail.groupAdmins ?? []).map((a) => nameById.get(a) ?? a).join("、") || "无"}</div>
          <div>{isOwner ? "您是群主，可执行全部管理操作。" : isAdmin ? "您是管理员，可管理成员/公告/禁言。" : "您是普通成员，仅查看群信息。"}</div>
        </div>

        {/* 成员列表 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Users className="h-4 w-4 text-muted" /> 成员（{memberIds.length}）</div>
          <div className="space-y-1.5">
            {memberIds.map((pid) => (
              <div key={pid} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                {(() => {
                  const memberUser = users.find(u => u.id === pid);
                  const avatarUrl = memberUser?.avatarUrl;
                  return <Avatar name={nameById.get(pid) ?? pid} avatarUrl={avatarUrl} size={28} />;
                })()}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-fg">{nameById.get(pid) ?? pid}</div>
                  <div className="text-[10px] text-muted">{showChatName(pid)}</div>
                </div>
                {canModerate && !(detail.groupOwner === pid) && !(isAdmin && pid === me?.id) && (
                  <button
                    title="移除成员"
                    aria-label="移除成员"
                    disabled={removingId === pid}
                    onClick={async () => {
                      setRemovingId(pid);
                      const next = memberIds.filter((x) => x !== pid);
                      try {
                        await api.patch(`/conversations/${convId}`, { participantIds: next });
                        showToast("已移除成员");
                        await loadDetail();
                      } catch (err) { showToast("移除失败: " + (err as Error).message, "error"); }
                      finally { setRemovingId(null); }
                    }}
                    className="rounded p-1 text-muted transition-colors hover:text-destructive"
                  >
                    {removingId === pid ? <Spinner /> : <UserX className="h-4 w-4" />}
                  </button>
                )}
              </div>
            ))}
          </div>
          {canModerate && (
            <AddMember existing={new Set(memberIds)} nameById={nameById} onAdd={(id) => void addMember(id)} />
          )}
        </div>

        {/* 管理员管理（仅群主） */}
        {isOwner && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldCheck className="h-4 w-4 text-muted" /> 管理员</div>
            <div className="flex flex-wrap gap-2">
              {memberIds.filter((pid) => pid !== detail.groupOwner).map((pid) => {
                const isAdminNow = Array.isArray(detail.groupAdmins) && detail.groupAdmins.includes(pid);
                return (
                  <button
                    key={pid}
                    disabled={busyAdminId === pid}
                    onClick={async () => {
                      setBusyAdminId(pid);
                      const cur = Array.isArray(detail.groupAdmins) ? [...detail.groupAdmins] : [];
                      const next = isAdminNow ? cur.filter((x) => x !== pid) : [...cur, pid];
                      try {
                        await api.patch(`/conversations/${convId}`, { groupAdmins: next });
                        showToast(isAdminNow ? "已取消管理员" : "已设为管理员");
                        await loadDetail();
                      } catch (err) { showToast("操作失败: " + (err as Error).message, "error"); }
                      finally { setBusyAdminId(null); }
                    }}
                    className={cls("rounded-lg border px-2.5 py-1.5 text-xs", isAdminNow ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted hover:border-primary/40", busyAdminId === pid && "opacity-50")}
                  >
                    {nameById.get(pid) ?? pid}{isAdminNow ? " · 管理员" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 解散群（仅群主） */}
        {isOwner && (
          <div className="border-t border-border pt-4">
            <Button variant="danger" onClick={() => setToDissolve(true)} className="w-full">
              <Trash2 className="mr-2 h-4 w-4" /> 解散群聊
            </Button>
          </div>
        )}
      </div>

      {toDissolve && (
        <Modal open onClose={() => setToDissolve(false)} title="确认解散群聊">
          <div className="space-y-4">
            <p className="text-sm text-fg">解散后所有成员将无法访问该群聊及历史消息，且不可恢复。确定解散「{detail.title ?? "群聊"}」吗？</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setToDissolve(false)}>取消</Button>
              <Button variant="danger" onClick={async () => {
                try {
                  await api.del(`/conversations/${convId}`);
                  onChanged?.(detail);
                  onClose();
                } catch (err) { showToast("解散失败: " + (err as Error).message, "error"); setToDissolve(false); }
              }}>确认解散</Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function isUser(id: string): boolean {
  return id.startsWith("user_");
}

/** 添加成员下拉（GroupSettingsDialog 内部） */
function AddMember({ existing, nameById, onAdd }: { existing: Set<string>; nameById: Map<string, string>; onAdd: (id: string) => void }) {
  const [selected, setSelected] = useState("");
  const candidates = Array.from(nameById.entries())
    .filter(([id, _n]) => id && !existing.has(id))
    .map(([id, name]) => ({ id, name }));
  return (
    <div className="flex items-center gap-2 pt-1">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg outline-none"
      >
        <option value="">选择要添加的成员…</option>
        {candidates.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
      </select>
      <Button variant="secondary" disabled={!selected} onClick={() => { if (selected) { onAdd(selected); setSelected(""); } }}>添加</Button>
    </div>
  );
}