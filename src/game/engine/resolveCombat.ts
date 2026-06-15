// 战斗 / 乱斗结算骨架。来源：规则手册 9；开发指令 9.2。
// v0.1 不自动结算，仅自动列出可能发生战斗的房间，交房主确认。

import type { GameRoom, ResolveResult } from "../types";
import { getRoomLabel } from "../config/rooms";

/** 列出落点处有 ≥2 名存活玩家的房间（战斗/乱斗触发条件，规则 9.1） */
function combatRooms(room: GameRoom): { roomId: string; count: number }[] {
  const byRoom = new Map<string, number>();
  for (const p of room.players) {
    if (p.status !== "alive") continue;
    const dest = p.submittedAction?.toRoom;
    if (!dest) continue;
    byRoom.set(dest, (byRoom.get(dest) ?? 0) + 1);
  }
  return Array.from(byRoom.entries())
    .filter(([, n]) => n >= 2)
    .map(([roomId, count]) => ({ roomId, count }));
}

export function resolveCombat(room: GameRoom): ResolveResult {
  const rooms = combatRooms(room);
  const info =
    rooms.length === 0
      ? "本轮无房间出现 2 名以上存活玩家，预计无战斗。"
      : rooms
          .map(
            (r) =>
              `${getRoomLabel(r.roomId)}：${r.count} 名存活玩家（${r.count >= 3 ? "乱斗" : "战斗"}）`
          )
          .join("\n");
  return {
    status: "manual_required",
    title: "战斗 / 乱斗结算",
    autoInfo: `${info}\n\nv0.1 暂不自动结算战斗，请房主根据规则手册第 9 节确认扣血并手动调整生命值。`,
  };
}
