import { useEffect, useState } from "react";
import { Search, UserPlus, Check, X, ShieldAlert } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Input, Modal, Spinner, showToast, cls } from "./ui";
import { Avatar } from "./Avatar";

interface UserRef { id: string; username: string; displayName?: string; avatarUrl?: string }
interface ReqItem { id: string; fromUser: string; toUser: string; direction?: string; peerName?: string }

/** 好友：加好友 + 好友请求（同意/拒绝） */
export function FriendsDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const { state } = useAuth();
  const me = state.user;
  const [tab, setTab] = useState<"add" | "requests">("add");
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<UserRef[]>([]);
  const [requests, setRequests] = useState<ReqItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void api.get<Array<{ id: string; username: string; displayName?: string; avatarUrl?: string }>>("/auth/users").then((u) => setUsers(u ?? [])).catch(() => {});
    void api.get<{ requests: ReqItem[] }>("/privacy/friend-requests").then((r) => setRequests(r?.requests ?? [])).catch(() => {});
  }, []);

  const ql = q.trim().toLowerCase();
  const candidates = (users ?? []).filter((u) => u.id !== me?.id && (!ql || (u.displayName || u.username).toLowerCase().includes(ql)));
  const incoming = requests.filter((r) => r.direction === "incoming");

  const send = async (id: string) => {
    setBusyId(id);
    try { await api.post("/privacy/friend-request", { targetId: id }); showToast("好友请求已发送"); }
    catch (e) { showToast((e as Error).message, "error"); }
    finally { setBusyId(null); }
  };
  const accept = async (id: string) => {
    setBusyId(id);
    try { await api.post(`/privacy/friend-requests/${id}/accept`); showToast("已添加为好友"); onChanged?.(); }
    catch (e) { showToast((e as Error).message, "error"); }
    finally { setBusyId(null); }
  };
  const reject = async (id: string) => {
    setBusyId(id);
    try { await api.post(`/privacy/friend-requests/${id}/reject`); showToast("已拒绝"); }
    catch (e) { showToast((e as Error).message, "error"); }
    finally { setBusyId(null); }
  };

  return (
    <Modal open onClose={onClose} title="好友（加好友 / 请求）">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button variant={tab === "add" ? "primary" : "secondary"} onClick={() => setTab("add")} className="flex-1">查找/加好友</Button>
          <Button variant={tab === "requests" ? "primary" : "secondary"} onClick={() => setTab("requests")} className="flex-1">
            好友请求{incoming.length > 0 ? `(${incoming.length})` : ""}
          </Button>
        </div>

        {tab === "add" ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索昵称 / 用户名" className="pl-9" />
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {candidates.length === 0 && <p className="py-6 text-center text-sm text-muted">没有匹配的用户</p>}
              {candidates.map((u) => (
                <div key={u.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/10">
                  <Avatar name={u.displayName || u.username} avatarUrl={u.avatarUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">{u.displayName || u.username}</div>
                    <div className="truncate text-xs text-muted">@{u.username}</div>
                  </div>
                  <Button variant="secondary" onClick={() => void send(u.id)} disabled={busyId === u.id} className="px-2.5 py-1.5 text-xs">
                    {busyId === u.id ? <Spinner /> : <><UserPlus className="mr-1 h-3.5 w-3.5" />加好友</>}
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {requests.length === 0 && <p className="py-6 text-center text-sm text-muted">暂无好友请求</p>}
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/10">
                <Avatar name={r.peerName || "用户"} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-fg">{r.peerName || "用户"}</div>
                  <div className="text-xs text-muted">{r.direction === "incoming" ? "发来好友请求" : "等待对方确认"}</div>
                </div>
                {r.direction === "incoming" ? (
                  <div className="flex gap-1.5">
                    <Button variant="primary" onClick={() => void accept(r.id)} disabled={busyId === r.id} className="px-2.5 py-1.5 text-xs"><Check className="mr-1 h-3.5 w-3.5" />同意</Button>
                    <Button variant="secondary" onClick={() => void reject(r.id)} disabled={busyId === r.id} className="px-2.5 py-1.5 text-xs"><X className="mr-1 h-3.5 w-3.5" />拒绝</Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => void reject(r.id)} disabled={busyId === r.id} className="px-2.5 py-1.5 text-xs"><X className="mr-1 h-3.5 w-3.5" />撤销</Button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-start gap-2 rounded-lg bg-muted/10 p-3 text-xs text-muted">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>对方隐私设置可能不允许被添加（allowAddFriend=false 时无法申请）。</span>
        </div>
      </div>
    </Modal>
  );
}