/**
 * 群公告页（P0）：查看/编辑群公告
 * GET /api/conversations/:convId — 获取 announcement
 * PUT /api/conversations/:id/announcement — 群主/管理员编辑
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Megaphone, Save, Edit3 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Avatar } from "../components/Avatar";
import { Button, Card, Spinner, Textarea, cls, showToast } from "../components/ui";
import { normalizeRole, ROLE_LEVEL, type OrgRole } from "@ensemble/shared";

export default function GroupAnnouncementPage() {
  const navigate = useNavigate();
  const { state } = useAuth();
  const convId = new URLSearchParams(window.location.search).get("convId") ?? "";
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const myRole = normalizeRole(state.user?.role ?? "member");
  const canEdit = ROLE_LEVEL[myRole] >= ROLE_LEVEL.admin;

  useEffect(() => {
    if (!convId) return;
    setLoading(true);
    api.get<{ announcement?: string }>(`/conversations/${convId}`)
      .then((d) => { const a = d.announcement || ""; setContent(a); setOriginal(a); })
      .finally(() => setLoading(false));
  }, [convId]);

  async function save() {
    if (!content.trim() || content === original) return;
    setSaving(true);
    try {
      await api.put(`/groups/${convId}/announcement`, { text: content.trim() });
      setOriginal(content.trim());
      showToast("公告已更新");
    } catch (e) { showToast((e as Error).message || "保存失败", "error"); }
    finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> 返回
      </button>
      <h1 className="mb-4 text-lg font-bold text-fg"><Megaphone className="inline h-5 w-5 mr-1" /> 群公告</h1>
      {loading ? <Spinner /> : (
        <Card className="p-5">
          {canEdit ? (
            <>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} className="mb-3" placeholder="输入群公告内容（支持 Markdown）" />
              <div className="flex justify-end">
                <Button variant="primary" onClick={() => void save()} disabled={saving || content === original}>
                  <Save className="h-4 w-4 mr-1" /> {saving ? "保存中…" : "保存"}
                </Button>
              </div>
            </>
          ) : (
            <div className="whitespace-pre-wrap text-sm text-fg min-h-[120px]">
              {content || <span className="text-muted">暂无公告</span>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
