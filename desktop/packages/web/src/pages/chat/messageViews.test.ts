import { describe, it, expect } from "vitest";
import {
  agentTint,
  bubbleVariantOf,
  dayLabel,
  groupMessagesByDay,
} from "./messageViews";
import type { ChatMessage, Contact } from "./types";

/**
 * 消息展示层的纯函数测试（不需 DOM 环境）。
 *
 * 覆盖今天 ChatPage 拆分时实际动过的四个函数——它们是消息渲染的判定核心，
 * 改错了不会白屏但会渲染错（tsc 与运行时都难发现），故固化在此。
 */

function msg(partial: Partial<ChatMessage> & { id: string; timestamp: number }): ChatMessage {
  return {
    contactId: "c1",
    content: "",
    sender: "assistant",
    ...partial,
  } as ChatMessage;
}

const contact = (type: Contact["type"], extra: Partial<Contact> = {}): Contact =>
  ({ id: "c1", type, name: "X", ...extra }) as Contact;

describe("agentTint —— agentId 稳定散列到身份色", () => {
  const TINTS = [
    "bg-agent-violet/10 text-agent-violet",
    "bg-agent-sky/10 text-agent-sky",
    "bg-agent-emerald/10 text-agent-emerald",
    "bg-agent-amber/10 text-agent-amber",
    "bg-agent-rose/10 text-agent-rose",
  ];

  it("同一 agentId 恒定返回同一身份色（散列稳定）", () => {
    for (const id of ["a", "agent-1", "规划Agent", "x", ""]) {
      expect(agentTint(id)).toBe(agentTint(id));
    }
  });

  it("返回值必在五色 token 内，且不退回 Tailwind 原生色类", () => {
    for (let i = 0; i < 200; i++) {
      const tint = agentTint(`agent-${i}`);
      expect(TINTS).toContain(tint);
      // token 化后不应再出现原生色板类名（3f0526c 统一的成果）
      expect(tint).not.toMatch(/(violet|sky|emerald|amber|rose)-\d00/);
    }
  });

  it("不同 agentId 能分散到多个色（不是全部同色）", () => {
    const used = new Set(Array.from({ length: 50 }, (_, i) => agentTint(`agent-${i}`)));
    expect(used.size).toBeGreaterThan(1);
  });
});

describe("bubbleVariantOf —— 气泡变体判定", () => {
  const me = "u-me";

  it("自己发的恒为 mine", () => {
    expect(bubbleVariantOf(msg({ id: "1", sender: "user", timestamp: 0 }), contact("group"), me))
      .toBe("mine");
  });

  it("agent 会话里的助手回复为 ai-ghost（1:1 对话形态）", () => {
    expect(bubbleVariantOf(msg({ id: "1", timestamp: 0 }), contact("agent"), me))
      .toBe("ai-ghost");
  });

  it("群聊中他人 agent 发言为 agent（按身份色区分）", () => {
    expect(bubbleVariantOf(msg({ id: "1", agentId: "ag1", timestamp: 0 }), contact("group"), me))
      .toBe("agent");
  });

  it("群聊中自己发言不带 agentId 时为 theirs，不误判为 agent", () => {
    expect(bubbleVariantOf(msg({ id: "1", agentId: me, timestamp: 0 }), contact("group"), me))
      .toBe("theirs");
  });

  it("用户会话里对方发言为 theirs（非群聊不套身份色）", () => {
    expect(bubbleVariantOf(msg({ id: "1", agentId: "u-other", timestamp: 0 }), contact("user"), me))
      .toBe("theirs");
  });
});

describe("dayLabel —— 日期分割线文案", () => {
  const daysFromNow = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(12, 0, 0, 0); // 避开时区与午夜边界
    return d;
  };

  it("今天 / 昨天用相对日期", () => {
    expect(dayLabel(daysFromNow(0))).toBe("今天");
    expect(dayLabel(daysFromNow(-1))).toBe("昨天");
  });

  it("今年内的更早日期用 M月D日", () => {
    expect(dayLabel(daysFromNow(-3))).toMatch(/^\d{1,2}月\d{1,2}日$/);
  });

  it("跨年日期带年份", () => {
    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    lastYear.setMonth(5);
    lastYear.setDate(15);
    lastYear.setHours(12, 0, 0, 0);
    expect(dayLabel(lastYear)).toContain("年");
  });
});

describe("groupMessagesByDay —— 按自然日分组", () => {
  const at = (dayOffset: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };

  it("同一天的消息归入一组，跨天则分组", () => {
    const groups = groupMessagesByDay([
      msg({ id: "a", timestamp: at(-1, 9) }),
      msg({ id: "b", timestamp: at(-1, 20) }),
      msg({ id: "c", timestamp: at(0, 8) }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((m) => m.id)).toEqual(["a", "b"]);
    expect(groups[1].items.map((m) => m.id)).toEqual(["c"]);
  });

  it("保持原有顺序，不重排", () => {
    const groups = groupMessagesByDay([
      msg({ id: "1", timestamp: at(0, 10) }),
      msg({ id: "2", timestamp: at(0, 11) }),
      msg({ id: "3", timestamp: at(-1, 9) }),
    ]);
    // 分组只按「相邻同天」聚合，不按日期排序
    expect(groups.map((g) => g.items.map((m) => m.id))).toEqual([["1", "2"], ["3"]]);
  });

  it("每组带 day 键与人类可读 label", () => {
    const [g] = groupMessagesByDay([msg({ id: "a", timestamp: at(0, 9) })]);
    expect(g.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(g.label).toBe("今天");
  });

  it("空数组返回空分组", () => {
    expect(groupMessagesByDay([])).toEqual([]);
  });
});