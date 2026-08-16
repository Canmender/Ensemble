/**
 * 隐私设置弹窗 —— 移动端 PrivacySettingsPage 的桌面对齐
 * 管理好友验证 / 雁聊权限 / 限信息展示，对应服务端 /api/privacy
 */
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Modal, showToast } from "./ui";

interface PrivacySettings {
  allowAddFriend: boolean;
  requireFriendApproval: boolean;
  allowPrivateChat: boolean;
  voiceReminder: boolean;
  showPhone: boolean;
  showEmail: boolean;
}

const DEFAULT: PrivacySettings = {
  allowAddFriend: true,
  requireFriendApproval: false,
  allowPrivateChat: true,
  voiceReminder: true,
  showPhone: false,
  showEmail: false,
};

const ITEMS: Array<{ key: keyof PrivacySettings; label: string; desc: string }> = [
  { key: "allowAddFriend", label: "允许被添加好友", desc: "关闭后他人无法向你发送好友请求" },
  { key: "requireFriendApproval", label: "好友验证", desc: "添加好友时需要你审核通过" },
  { key: "allowPrivateChat", label: "允许私聊", desc: "关闭后非好友无法与你私聊" },
  { key: "voiceReminder", label: "消息语音提醒", desc: "收到新消息时播放提示音" },
  { key: "showPhone", label: "展示手机号", desc: "其他用户可在你的资料页看到手机号" },
  { key: "showEmail", label: "展示邮箱", desc: "其他用户可在你的资料页看到邮箱" },
];

/** 自画开关 */
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ background: value ? "var(--primary)" : "rgba(128,128,128,0.3)" }}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
        style={{ left: value ? "calc(100% - 22px)" : 2 }}
      />
    </button>
  );
}

export function PrivacySettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULT);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get<Partial<PrivacySettings>>("/privacy")
      .then((r) => setSettings({ ...DEFAULT, ...r }))
      .catch(() => showToast("加载隐私设置失败", "error"))
      .finally(() => setLoading(false));
  }, [open]);

  async function toggle(key: keyof PrivacySettings, value: boolean) {
    const prev = settings;
    setSettings((s) => ({ ...s, [key]: value }));
    try {
      await api.patch("/privacy", { [key]: value });
    } catch (e) {
      setSettings(prev);
      showToast("保存失败：" + ((e as Error).message || "未知"), "error");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="隐私设置">
      {loading ? (
        <p className="py-8 text-center text-sm text-muted">加载中…</p>
      ) : (
        <div className="space-y-2">
          {ITEMS.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-fg">{item.label}</p>
                <p className="text-xs text-muted">{item.desc}</p>
              </div>
              <Toggle value={settings[item.key]} onChange={(v) => void toggle(item.key, v)} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}