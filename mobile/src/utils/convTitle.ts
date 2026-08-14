import type { Conversation, UserInfo } from "../services/api";
import { useDeviceStore } from "../store/deviceStore";

// 会话标题：用户-用户会话显示对方昵称（过滤自己），群显示群名
export function convTitle(c: Conversation, usersById: Map<string, UserInfo>): string {
  if (c.runId.startsWith("conv_")) {
    const meId = useDeviceStore.getState().connectedDevice?.id;
    const otherIds = (c.participantIds ?? []).filter((pid) => pid !== meId);
    const names = otherIds.map((pid) => {
      const u = usersById.get(pid);
      return u ? u.displayName || u.username || pid : pid;
    });
    return names.join(", ") || "会话";
  }
  return c.title || (c.participantIds ?? []).join(", ") || "会话";
}
