import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ArrowLeft, Check } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Avatar } from "../components/Avatar";
import { Button, Card, Input, Label, cls, showToast } from "../components/ui";

/** 个人信息页：头像 / 昵称 / 用户名 / ID，可改昵称、传头像 */
export default function ProfilePage() {
  const navigate = useNavigate();
  const { state, login } = useAuth();
  const user = state.user;

  const [me, setMe] = useState<{ displayName?: string; username: string; avatarUrl?: string; id: string; role?: string } | null>(null);
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const d = await api.get<{ displayName?: string; username: string; avatarUrl?: string; id: string; role?: string }>("/auth/me");
        if (d) { setMe(d); setNickname(d.displayName || ""); }
      } catch { /* 用 auth state 兜底 */ }
    })();
  }, []);

  const saveNickname = async () => {
    if (!nickname.trim()) { showToast("昵称不能为空", "error"); return; }
    setSaving(true);
    try {
      const d = await api.patch<{ displayName?: string }>("/auth/me", { displayName: nickname.trim() });
      showToast("已保存");
      setMe((m) => (m ? { ...m, displayName: d?.displayName ?? nickname.trim() } : m));
    } catch (e) {
      showToast((e as Error).message || "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = () => fileRef.current?.click();

  const onAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return;
      const base64 = result.split(",")[1] || "";
      void (async () => {
        setUploading(true);
        try {
          const d = await api.post<{ url?: string }>("/auth/avatar", { data: base64, mime: file.type || "image/jpeg" });
          showToast("头像已更新");
          setMe((m) => (m ? { ...m, avatarUrl: d?.url } : m));
        } catch (err) {
          showToast((err as Error).message || "上传失败", "error");
        } finally {
          setUploading(false);
          if (fileRef.current) fileRef.current.value = "";
        }
      })();
    };
    reader.readAsDataURL(file);
  };

  const name = me?.displayName || me?.username || (user?.displayName ?? user?.username) || "用户";

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg focus-visible:outline-none"
      >
        <ArrowLeft className="h-4 w-4" /> 返回
      </button>

      <div className="mb-6 flex flex-col items-center">
        <div className="relative">
          <Avatar name={name} avatarUrl={me?.avatarUrl} size={96} />
          <button
            onClick={onPickAvatar}
            disabled={uploading}
            title="更换头像"
            className="absolute -bottom-0 -right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-fg shadow-md transition-colors hover:bg-primary/90"
          >
            {uploading ? "…" : <Camera className="h-4 w-4" />}
          </button>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-fg">{name}</h1>
        <p className="text-sm text-muted">@{me?.username}</p>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onAvatarFile} />

      <Card className="p-5">
        <div className="space-y-1">
          <div className="flex justify-between py-1"><span className="text-sm text-muted">昵称</span><span className="text-sm text-fg">{me?.displayName || "未设置"}</span></div>
          <div className="flex justify-between py-1"><span className="text-sm text-muted">用户名</span><span className="text-sm text-fg">@{me?.username}</span></div>
          <div className="flex justify-between py-1"><span className="text-sm text-muted">用户 ID</span><span className="text-sm text-fg break-all">{me?.id}</span></div>
          {me?.role && <div className="flex justify-between py-1"><span className="text-sm text-muted">角色</span><span className="text-sm text-fg">{me.role}</span></div>}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <Label>修改昵称</Label>
        <div className="mt-2 flex gap-2">
          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="输入新昵称" maxLength={30} />
          <Button variant="primary" onClick={saveNickname} disabled={saving} className="shrink-0">
            {saving ? "保存中…" : (<><Check className="h-4 w-4" /> 保存</>)}
          </Button>
        </div>
      </Card>
    </div>
  );
}
