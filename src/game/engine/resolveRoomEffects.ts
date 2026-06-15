// 房间效果结算骨架。来源：规则手册 14；开发指令 9.2。

import type { GameRoom, ResolveResult } from "../types";
import { getRoomLabel } from "../config/rooms";
import { getRoomFunction } from "../config/roomFunctions";

export function resolveRoomEffects(room: GameRoom): ResolveResult {
  // 自动列出本轮玩家落点中涉及的功能房间，便于房主逐一处理
  const dests = new Set<string>();
  for (const p of room.players) {
    const d = p.submittedAction?.toRoom;
    if (d) dests.add(d);
  }
  const funcRooms = Array.from(dests)
    .map((id) => ({ id, fn: getRoomFunction(id) }))
    .filter((x) => x.fn);

  const info =
    funcRooms.length === 0
      ? "本轮玩家落点未涉及功能房间。"
      : funcRooms.map((x) => `${getRoomLabel(x.id)}：${x.fn!.effect}`).join("\n");

  return {
    status: "manual_required",
    title: "房间效果结算",
    autoInfo: `${info}\n\nv0.1 暂不自动结算房间功能与抽卡，请房主根据规则手册第 14 节确认。`,
  };
}
