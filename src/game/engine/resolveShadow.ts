// 暗影吸血结算骨架。来源：规则手册 13.3-13.7；开发指令 9.2。

import type { GameRoom, ResolveResult } from "../types";
import { getRoomLabel } from "../config/rooms";

export function resolveShadow(room: GameRoom): ResolveResult {
  const shadows = room.players.filter((p) => p.status === "shadow");
  let info: string;
  if (shadows.length === 0) {
    info = "本轮没有暗影玩家。";
  } else {
    // 列出暗影落点，便于房主判断是否与存活玩家同房间
    info = shadows
      .map((s) => `暗影 ${s.name} → ${getRoomLabel(s.submittedAction?.toRoom ?? s.location ?? "未知")}`)
      .join("\n");
  }
  return {
    status: "manual_required",
    title: "暗影吸血结算",
    autoInfo: `${info}\n\nv0.1 暂不自动结算暗影吸血与复活，请房主根据规则手册第 13 节确认。`,
  };
}
