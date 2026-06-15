// 提交本轮行动。来源：开发指令 6.4、8.3。

import type { GameRoom, Player, PlayerRoundAction } from "../types";
import { appendLog, nowISO } from "./helpers";
import { ROOM_IDS } from "../config/rooms";
import { FLOOR_IDS } from "../config/floors";

export interface ActionInput {
  toRoom: string;
  path?: string[];
  gasVoteFloor?: string | null;
  roomAction?: string;
  notes?: string;
}

/**
 * 校验并提交玩家行动。
 * 规则校验：
 * - 目标房间不能为空，且必须是合法房间；
 * - 存活玩家必须移动，目标房间不能等于上一轮房间（规则 4.3）；
 * - 暗影不参与毒气投票（规则 7.7 / 13.2），强制忽略其投票；
 * - 存活玩家必须选择毒气投票楼层。
 */
export function submitAction(
  room: GameRoom,
  playerId: string,
  input: ActionInput
): GameRoom {
  if (room.currentPhase !== "ACTION") throw new Error("当前不是行动阶段。");
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");

  if (!input.toRoom) throw new Error("请选择目标房间。");
  if (!ROOM_IDS.includes(input.toRoom)) throw new Error("非法的目标房间。");

  const isAlive = player.status === "alive";

  if (isAlive && player.location && input.toRoom === player.location) {
    throw new Error("存活玩家每轮必须移动，目标房间不能与上一轮相同。");
  }

  let gasVoteFloor: string | null = null;
  if (isAlive) {
    if (!input.gasVoteFloor) throw new Error("请选择毒气投票楼层。");
    if (!FLOOR_IDS.includes(input.gasVoteFloor)) throw new Error("非法的毒气投票楼层。");
    gasVoteFloor = input.gasVoteFloor;
  }
  // 暗影：忽略毒气投票，gasVoteFloor 保持 null。

  const action: PlayerRoundAction = {
    round: room.currentRound,
    fromRoom: player.location,
    toRoom: input.toRoom,
    path: input.path,
    gasVoteFloor,
    roomAction: isAlive ? input.roomAction : undefined,
    notes: input.notes,
    submittedAt: nowISO(),
  };

  const updated: Player = { ...player, submittedAction: action };
  let next: GameRoom = {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    updatedAt: nowISO(),
  };
  next = appendLog(next, `${player.name} 已提交本轮行动。`);
  return next;
}

/** 房主重置某玩家提交，便于修正。来源：开发指令 6.4。 */
export function resetPlayerAction(room: GameRoom, playerId: string): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  const updated: Player = { ...player, submittedAction: null };
  let next: GameRoom = {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    updatedAt: nowISO(),
  };
  next = appendLog(next, `房主重置了 ${player.name} 的提交。`);
  return next;
}

/** 所有已就座玩家是否都已提交（用于行动阶段进度） */
export function allSubmitted(room: GameRoom): boolean {
  const seated = room.players.filter((p) => p.name);
  return seated.length > 0 && seated.every((p) => p.submittedAction);
}
