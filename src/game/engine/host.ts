// 房主手动修正操作。来源：开发指令 7、4.4。
// v0.1 规则复杂，房主需要能手动调整状态以便真实试玩。

import type { GameRoom, Player, PlayerStatus } from "../types";
import { appendLog, nowISO } from "./helpers";

function replacePlayer(room: GameRoom, player: Player): GameRoom {
  return {
    ...room,
    players: room.players.map((p) => (p.id === player.id ? player : p)),
    updatedAt: nowISO(),
  };
}

/** 手动调整玩家生命值（delta 可正可负），限制在 [0, maxHp]。 */
export function adjustHp(room: GameRoom, playerId: string, delta: number): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  const hp = Math.max(0, Math.min(player.maxHp, player.hp + delta));
  const updated: Player = { ...player, hp };
  let next = replacePlayer(room, updated);
  next = appendLog(
    next,
    `房主调整 ${player.name} 生命值：${player.hp} → ${hp}。`
  );
  return next;
}

/** 手动设置玩家状态（存活 / 暗影） */
export function setPlayerStatus(
  room: GameRoom,
  playerId: string,
  status: PlayerStatus
): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  const updated: Player = { ...player, status };
  let next = replacePlayer(room, updated);
  next = appendLog(
    next,
    `房主将 ${player.name} 设为${status === "shadow" ? "暗影" : "存活"}。`
  );
  return next;
}

/** 手动添加一条公开日志 */
export function addPublicLog(room: GameRoom, message: string): GameRoom {
  const msg = message.trim();
  if (!msg) return room;
  return appendLog(room, `[房主] ${msg}`);
}
