import { describe, it, expect } from "vitest";
import { isPluginCard } from "@ensemble/shared";

/**
 * U1 兼容性契约（shared 协议层）：isPluginCard 守卫拒绝畸形载荷，
 * 未识别 cardType 由客户端折叠框降级（渲染层行为，web 手测验收）。
 */
const v1card = {
  cardType: "poll",
  cardVersion: 1 as const,
  title: "q",
  state: {},
  actions: [{ id: "a", label: "l", endpoint: "/vote" }],
};

describe("isPluginCard 守卫", () => {
  it("合法 v1 卡片通过", () => {
    expect(isPluginCard({ type: "plugin-card", name: "p", size: 1, url: "", card: v1card })).toBe(true);
  });
  it("缺 card / 版本不符 / actions 缺失 / 非对象均拒绝", () => {
    expect(isPluginCard({ type: "plugin-card", name: "p", size: 1, url: "" })).toBe(false);
    expect(isPluginCard({ type: "plugin-card", name: "p", size: 1, url: "", card: { ...v1card, cardVersion: 2 } })).toBe(false);
    expect(isPluginCard({ type: "plugin-card", name: "p", size: 1, url: "", card: { ...v1card, actions: undefined } })).toBe(false);
    expect(isPluginCard(null)).toBe(false);
    expect(isPluginCard("poll")).toBe(false);
  });
});
