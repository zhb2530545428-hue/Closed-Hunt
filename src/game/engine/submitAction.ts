// 提交本轮行动。来源：开发指令 6.4、8.3；v0.3 接入地图移动合法性与激光室即时伤害。

import type { GameRoom, Player, PlayerRoundAction, RoleSkillInput } from "../types";
import { appendLog, appendPrivateLog, nowISO } from "./helpers";
import { ROOM_IDS, getRoomLabel } from "../config/rooms";
import { FLOOR_IDS } from "../config/floors";
import { isOverweight } from "../inventory";
import { buildMoveContext, validateMove, findShortestPath } from "../utils/movement";
import { applyDeclaredSkill } from "./roleEffects";
import { currentTurnPlayerId } from "./advancePhase";

export interface ActionInput {
  toRoom: string;
  gasVoteFloor?: string | null;
  roomAction?: string;
  useItems?: string[];
  rocketTargetRoom?: string;
  submitWater?: boolean;
  submitFood?: boolean;
  roleSkill?: RoleSkillInput;
  notes?: string;
}

/**
 * 校验并提交玩家行动。
 * v0.3：通过 validateMove 判断目标是否在速度可达范围内（含特殊移动）、不可原地停留。
 * v1.0.1：① 严格按顺位行动——只有当前顺位玩家可提交，且结束行动后不可再改（§7）；
 *         ② 激光室伤害不再即时扣血，延迟到结算阶段统一处理（§8），行动阶段仅做私密提示；
 *         ③ 行动阶段日志写为私密，不实时进入公共日志（§13）。
 */
export function submitAction(
  room: GameRoom,
  playerId: string,
  input: ActionInput
): GameRoom {
  if (room.currentPhase !== "ACTION") throw new Error("当前不是行动阶段。");
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");

  // 行动锁（§7）：仅当前顺位玩家可提交；提交后即锁定移动/投票/技能，不能再改（如需更正由房主重置）。
  if (player.endedAction) throw new Error("你已结束本轮行动，无法再修改。");
  if (player.submittedAction?.round === room.currentRound) {
    throw new Error("你已提交本轮移动，确认后不可修改（如需更正请房主重置提交）。");
  }
  // 顺位锁只约束「在顺位中的玩家」（持顺位卡的存活玩家）；暗影无顺位卡，可在行动阶段自由提交移动。
  const turnId = currentTurnPlayerId(room);
  if (player.orderCard != null && turnId && turnId !== playerId) {
    throw new Error("还没轮到你行动，请按顺位等待。");
  }

  const isAlive = player.status === "alive";

  // 超重时不能提交行动（规则 6.4 / 开发指令 3.3.5）
  if (isOverweight(player)) {
    throw new Error("道具超过负重，请先丢弃多余道具再提交。");
  }

  // 私家侦探跟踪：放弃移动，移动到已提交的目标玩家本轮终点房间（规则 3.2）。
  // 需在目标提交后才能使用（前序顺位提交完毕），被催眠时不可用。
  let trackTargetId: string | undefined;
  let effectiveToRoom = input.toRoom;
  if (isAlive && input.roleSkill?.type === "track") {
    if (player.roleId !== "detective") throw new Error("非私家侦探不能跟踪。");
    if (player.forcedRoom) throw new Error("被催眠时无法使用跟踪。");
    if ((player.roleUses ?? 0) >= 3) throw new Error("跟踪次数已用尽。");
    const target = room.players.find((p) => p.id === input.roleSkill!.targetPlayerIds?.[0]);
    if (!target) throw new Error("跟踪目标不存在。");
    if (target.id === player.id) throw new Error("不能跟踪自己。");
    if (target.status !== "alive") throw new Error("只能跟踪存活玩家。");
    if (target.trackedDone) throw new Error("该玩家本局已被跟踪过。");
    if (!target.submittedAction || target.submittedAction.round !== room.currentRound) {
      throw new Error("需等该玩家先提交行动后才能跟踪。");
    }
    effectiveToRoom = target.submittedAction.toRoom;
    trackTargetId = target.id;
  }

  if (!effectiveToRoom) throw new Error("请选择目标房间。");
  if (!ROOM_IDS.includes(effectiveToRoom)) throw new Error("非法的目标房间。");

  // 移动校验；催眠强制移动 / 侦探跟踪可超出自身速度，按普通最短路径直达。
  const ctx = buildMoveContext(player);
  let preview = validateMove(ctx, effectiveToRoom);
  const directMove = !!player.forcedRoom || !!trackTargetId;
  if (player.forcedRoom && effectiveToRoom !== player.forcedRoom && !trackTargetId) {
    throw new Error(`你被催眠，本轮必须前往 ${getRoomLabel(player.forcedRoom)}。`);
  }
  if (directMove && !preview.ok) {
    const path = findShortestPath(ctx, effectiveToRoom) ?? [ctx.fromRoomId, effectiveToRoom];
    preview = {
      ok: true,
      toRoom: effectiveToRoom,
      steps: Math.max(0, path.length - 1),
      path,
      specialMoves: [],
      passesLaser: isAlive && path.slice(1).includes("102"),
      warnings: [],
    };
  } else if (!preview.ok) {
    throw new Error(preview.reason ?? "移动不合法。");
  }

  let gasVoteFloor: string | null = null;
  if (isAlive) {
    if (!input.gasVoteFloor) throw new Error("请选择毒气投票楼层。");
    if (!FLOOR_IDS.includes(input.gasVoteFloor)) throw new Error("非法的毒气投票楼层。");
    gasVoteFloor = input.gasVoteFloor;
  }

  const useItems = isAlive ? (input.useItems ?? []).filter((id) => player.inventory.includes(id)) : [];

  // 激光室伤害延迟到结算（§8）：此处不扣血，仅记录提示。
  const triggered: string[] = [...preview.warnings];

  const action: PlayerRoundAction = {
    round: room.currentRound,
    fromRoom: player.location,
    toRoom: effectiveToRoom,
    path: preview.path,
    stepsUsed: preview.steps,
    usedSpecialMove: preview.specialMoves.length ? preview.specialMoves : undefined,
    triggeredEffects: triggered.length ? triggered : undefined,
    gasVoteFloor,
    roomAction: isAlive ? input.roomAction : undefined,
    useItems,
    rocketTargetRoom: isAlive ? input.rocketTargetRoom : undefined,
    submitWater: isAlive ? input.submitWater : undefined,
    submitFood: isAlive ? input.submitFood : undefined,
    roleSkill: isAlive ? input.roleSkill : undefined,
    notes: input.notes,
    submittedAt: nowISO(),
  };

  const updated: Player = { ...player, submittedAction: action };
  let next: GameRoom = {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    updatedAt: nowISO(),
  };

  // 处理声明的主动技能（催眠/死亡预告/黑客会改动房间或其他玩家状态）。校验失败会抛错。
  // §13：技能日志写为私密（仅本人可见），不实时公开（如催眠目标不能被他人看到）。
  if (action.roleSkill && action.roleSkill.type !== "track") {
    const skillResult = applyDeclaredSkill(next, playerId);
    next = skillResult.room;
    for (const m of skillResult.logs) next = appendPrivateLog(next, playerId, m);
  }

  // 侦探跟踪：登记次数并标记目标已被跟踪。
  if (trackTargetId) {
    next = {
      ...next,
      players: next.players.map((p) => {
        if (p.id === playerId) return { ...p, roleUses: (p.roleUses ?? 0) + 1 };
        if (p.id === trackTargetId) return { ...p, trackedDone: true };
        return p;
      }),
    };
    const tname = room.players.find((p) => p.id === trackTargetId)?.name ?? "目标";
    next = appendPrivateLog(next, playerId, `你跟踪了 ${tname}，移动到其本轮所处房间。`);
  }

  // §13：移动/路径/激光等都属私密，仅本人面板可见，结算后才公开。
  const pathText = preview.path.map(getRoomLabel).join(" → ");
  next = appendPrivateLog(
    next,
    playerId,
    `你从 ${getRoomLabel(ctx.fromRoomId)} 移动到 ${getRoomLabel(effectiveToRoom)}，路径：${pathText}，消耗 ${preview.steps} 步。`
  );
  if (preview.specialMoves.length) next = appendPrivateLog(next, playerId, `本轮${specialText(preview.specialMoves)}。`);
  if (preview.passesLaser) next = appendPrivateLog(next, playerId, "本轮路径经过/停留 102 激光室，结算阶段将受到 -1 生命。");
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

/**
 * 房主重置某玩家提交，便于纠错（§7 纠错模式）。激光伤害已延迟到结算，这里无需回退生命。
 * 同时清除「已结束行动」标记，使该玩家可在本轮重新行动。
 * 注意：已抽到的道具/已落地的技能效果不会自动撤销，需房主用高级纠错另行调整。
 */
export function resetPlayerAction(room: GameRoom, playerId: string): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  const updated: Player = { ...player, submittedAction: null, endedAction: false };
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
