import type { Conversation, UserInfo } from "../services/api";
import { useMeStore } from "../store/meStore";

// 会话标题：用户-用户会话显示对方昵称（过滤掉自己）；群显示群名。
// 对方可能出现在 userId（会话创建方）或 participantIds（被邀请方）之一，
// 取决于谁发起。因此要合并两者再过滤掉「当前登录用户」，否则有一方视角会看到自己/空。
// meId 必须是用户 id（me.id），不能用设备 id。
export function convTitle(c: Conversation, usersById: Map<string, UserInfo>): string {
  if (c.runId.startsWith("conv_")) {
    const meId = useMeStore.getState().me?.id;
    const candidateIds = [c.userId, ...(c.participantIds ?? [])].filter((x): x is string => !!x && x !== "conv_");
    const otherIds = meId ? candidateIds.filter((pid) => pid !== meId) : candidateIds;
    const seen = new Set<string>();
    const names = otherIds
      .filter((pid) => (seen.has(pid) ? false : (seen.add(pid), true)))
      .map((pid) => {
        const u = usersById.get(pid);
        return u ? u.displayName || u.username || pid : pid;
      });
    return names.join(", ") || "会话";
  }
  return c.title || (c.participantIds ?? []).join(", ") || "会话";
}
