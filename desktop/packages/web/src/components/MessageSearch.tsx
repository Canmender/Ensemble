/**
 * 消息搜索（P1-3）：聊天页顶部搜索图标 → 搜索框 → FTS5 结果列表
 * 接口：GET /api/messages/search?q=&convId=&limit=20
 */
import { useState, useCallback } from "react";
import { Search, X, Highlighter } from "lucide-react";
import { api } from "../lib/api";

interface SearchResult {
  id: string;
  runId: string;
  content: string;
  snippet: string;
}

interface MessageSearchProps {
  convId?: string; // 当前会话 ID（可选，不传则全局搜索）
  onSelectMessage?: (messageId: string) => void;
}

export function MessageSearch({ convId, onSelectMessage }: MessageSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: "20" });
      if (convId) params.set("convId", convId);
      const data = await api.get<SearchResult[]>(`/messages/search?${params}`);
      setResults(data);
    } catch (e) {
      console.error("搜索失败:", e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, convId]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg p-1.5 text-muted hover:bg-muted/10 hover:text-fg transition-colors"
        title="搜索消息"
      >
        <Search className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="flex flex-col w-full max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }}
          placeholder="搜索消息内容…"
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-fg focus:border-primary focus:outline-none"
          autoFocus
        />
        <button
          onClick={() => void doSearch()}
          disabled={loading || !query.trim()}
          className="px-3 py-1.5 text-sm rounded bg-primary text-primary-fg disabled:opacity-50"
        >
          搜索
        </button>
        <button
          onClick={() => { setOpen(false); setQuery(""); setResults([]); }}
          className="p-1 text-muted hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {results.length > 0 && (
        <div className="space-y-1 mt-1 max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelectMessage?.(r.id)}
              className="w-full text-left p-2 rounded-lg hover:bg-muted/10 text-sm"
            >
              <div
                className="text-fg"
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
            </button>
          ))}
        </div>
      )}
      {results.length === 0 && query && !loading && (
        <div className="text-center text-xs text-muted py-2">无搜索结果</div>
      )}
    </div>
  );
}
