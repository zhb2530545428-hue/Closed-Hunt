// 提交本轮行动。来源：开发指令 6.4、8.3；v0.3 接入地图移动合法性与激光室即时伤害。

import type { GameRoom, Player, PlayerRoundAction } from "../types";
import { appendLog, nowISO } from "./helpers";
import { ROOM_IDS, getRoomLabel } from "../config/rooms";
import { FLOOR_IDS } from "../config/floors";
import { isOverweight } from "../inventory";
import { buildMoveContext, validateMove } from "../utils/movement";

export interface ActionInput {
  toRoom: string;
  gasVoteFloor?: string | null;
  roomAction?: string;
  useItems?: string[];
  rocketTargetRoom?: string;
  submitWater?: boolean;
  submitFood?: boolean;
  notes?: string;
}

/** 应用激光室即时伤害（存活、肾上腺素生效轮最低保留 1）。返回实际扣血。 */
function laserDamage(player: Player, round: number): number {
  const floor = player.adrenalineActiveRound === round ? 1 : 0;
  const newHp = Math.max(floor, player.hp - 1);
  return player.hp - newHp;
}

/**
 * 校验并提交玩家行动。
 * v0.3 校验：通过 validateMove 判断目标是否在速度可达范围内（含特殊移动）、不可原地停留；
 * 若路径经过/停留 102 激光室且为存活玩家，确认后立即扣 1 点生命（改提交会先回退旧激光伤害）。
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

  // 超重时不能提交行动（规则 6.4 / 开发指令 3.3.5）
  if (isOverweight(player)) {
    throw new Error("道具超过负重，请先丢弃多余道具再提交。");
  }

  // 地图移动合法性校验（规则 4）
  const ctx = buildMoveContext(player);
  const preview = validateMove(ctx, input.toRoom);
  if (!preview.ok) throw new Error(preview.reason ?? "移动不合法。");

  let gasVoteFloor: string | null = null;
  if (isAlive) {
    if (!input.gasVoteFloor) throw new Error("请选择毒气投票楼层。");
    if (!FLOOR_IDS.includes(input.gasVoteFloor)) throw new Error("非法的毒气投票楼层。");
    gasVoteFloor = input.gasVoteFloor;
  }

  const useItems = isAlive ? (input.useItems ?? []).filter((id) => player.inventory.includes(id)) : [];

  // 先回退上一份提交已造成的激光伤害，避免改提交时重复扣血
  let hp = player.hp;
  if (player.submittedAction?.laserDamageApplied) hp += player.submittedAction.laserDamageApplied;

  // 应用本次激光伤害（基于本次路径）
  const tmp: Player = { ...player, hp };
  const laser = preview.passesLaser ? laserDamage(tmp, room.currentRound) : 0;
  hp -= laser;

  const triggered: string[] = [...preview.warnings];

  const action: PlayerRoundAction = {
    round: room.currentRound,
    fromRoom: player.location,
    toRoom: input.toRoom,
    path: preview.path,
    stepsUsed: preview.steps,
    usedSpecialMove: preview.specialMoves.length ? preview.specialMoves : undefined,
    triggeredEffects: triggered.length ? triggered : undefined,
    laserDamageApplied: laser,
    gasVoteFloor,
    roomAction: isAlive ? input.roomAction : undefined,
    useItems,
    rocketTargetRoom: isAlive ? input.rocketTargetRoom : undefined,
    submitWater: isAlive ? input.submitWater : undefined,
    submitFood: isAlive ? input.submitFood : undefined,
    notes: input.notes,
    submittedAt: nowISO(),
  };

  const updated: Player = { ...player, hp, submittedAction: action };
  let next: GameRoom = {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    updatedAt: nowISO(),
  };
  const pathText = preview.path.map(getRoomLabel).join(" → ");
  next = appendLog(
    next,
    `${player.name} 从 ${getRoomLabel(ctx.fromRoomId)} 移动到 ${getRoomLabel(input.toRoom)}，路径：${pathText}，消耗 ${preview.steps} 步。`
  );
  if (preview.specialMoves.length) next = appendLog(next, `${player.name} ${specialText(preview.specialMoves)}。`);
  if (laser > 0) next = appendLog(next, `${player.name} 经过 102 激光室，受到 ${laser} 点伤害。`);
  return next;
}

function specialText(moves: string[]): string {
  const map: Record<string, string> = {
    helicopter: "搭乘直升机",
    portal: "使用传送室",
    trash_chute: "通过垃圾管道滑行",
    rope: "使用绳索上下楼",
    shadow: "以暗影身份上下楼",
  };
  return Array.from(new Set(moves)).map((m) => map[m] ?? m).join("、");
}

/** 房主重置某玩家提交，便于修正。会回退已造成的激光伤害。来源：开发指令 6.4。 */
export function resetPlayerAction(room: GameRoom, playerId: string): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  const restoreLaser = player.submittedAction?.laserDamageApplied ?? 0;
  const updated: Player = {
    ...player,
    hp: Math.min(player.maxHp, player.hp + restoreLaser),
    submittedAction: null,
  };
  let next: GameRoom = {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    updatedAt: nowISO(),
  };
  next = appendLog(next, `房主重置了 ${player.name} 的提交。`);
  return next;
}

/**
 * 提交后微调（同一行动阶段内）：更新道具使用 / 水粮计划 / 火箭筒目标 / 房间功能。
 * 用于抽卡后再声明使用新道具，不改动移动与毒气投票。
 */
export function reviseAction(
  room: GameRoom,
  playerId: string,
  patch: {
    useItems?: string[];
    rocketTargetRoom?: string;
    submitWater?: boolean;
    submitFood?: boolean;
    roomAction?: string;
  }
): GameRoom {
  if (room.currentPhase !== "ACTION") throw new Error("当前不是行动阶段。");
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !player.submittedAction) throw new Error("请先提交行动。");

  const a = player.submittedAction;
  const updated: Player = {
    ...player,
    submittedAction: {
      ...a,
      useItems:
        patch.useItems !== undefined
          ? patch.useItems.filter((id) => player.inventory.includes(id))
          : a.useItems,
      rocketTargetRoom: patch.rocketTargetRoom !== undefined ? patch.rocketTargetRoom : a.rocketTargetRoom,
      submitWater: patch.submitWater !== undefined ? patch.submitWater : a.submitWater,
      submitFood: patch.submitFood !== undefined ? patch.submitFood : a.submitFood,
      roomAction: patch.roomAction !== undefined ? patch.roomAction : a.roomAction,
    },
  };
  return {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    updatedAt: nowISO(),
  };
}

/** 所有已就座玩家是否都已提交（用于行动阶段进度） */
export function allSubmitted(room: GameRoom): boolean {
  const seated = room.players.filter((p) => p.name);
  return seated.length > 0 && seated.every((p) => p.submittedAction);
}
