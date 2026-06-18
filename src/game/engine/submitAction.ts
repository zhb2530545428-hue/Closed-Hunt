// 提交本轮行动。来源：开发指令 6.4、8.3；v0.3 接入地图移动合法性与激光室即时伤害。

import type { GameRoom, Player, PlayerRoundAction, RoleSkillInput } from "../types";
import { appendLog, appendPrivateLog, nowISO } from "./helpers";
import { ROOM_IDS, getRoomLabel } from "../config/rooms";
import { FLOOR_IDS } from "../config/floors";
import { isOverweight } from "../inventory";
import { isRoomFunctionDisabledForAction } from "../config/roomFunctions";
import { buildMoveContext, validateMove, findShortestPath } from "../utils/movement";
import { applyDeclaredSkill } from "./roleEffects";
import { currentTurnPlayerId } from "./advancePhase";
import { markSettlementConfirmed } from "./settlementConfirmation";

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
  const hypnosisPromptPending = (room.hypnosisDecisions ?? []).some(
    (d) =>
      d.roundId === String(room.currentRound) &&
      d.status === "pending" &&
      room.players.some((p) => p.id === d.hypnotistPlayerId && p.status === "alive")
  );
  if (hypnosisPromptPending) throw new Error("请先等待催眠师完成本轮行动前技能选择。");
  const turnId = currentTurnPlayerId(room);
  if (player.orderCard != null && turnId && turnId !== playerId) {
    throw new Error("还没轮到你行动，请按顺位等待。");
  }

  const isAlive = player.status === "alive";

  // 超重时不能提交行动（规则 6.4 / 开发指令 3.3.5）
  if (isOverweight(player)) {
    throw new Error("道具超过负重，请先丢弃多余道具再提交。");
  }

  const pendingHypnosis = (room.pendingHypnosis ?? []).find(
    (h) => h.targetPlayerId === playerId && h.roundId === String(room.currentRound) && h.status === "pending"
  );
  const forcedRoom = pendingHypnosis?.forcedRoomId;

  // 私家侦探跟踪：放弃移动，移动到已提交的目标玩家本轮终点房间（规则 3.2）。
  // 需在目标提交后才能使用（前序顺位提交完毕），被催眠时不可用。
  let trackTargetId: string | undefined;
  let effectiveToRoom = input.toRoom;
  if (isAlive && input.roleSkill?.type === "track") {
    if (player.roleId !== "detective") throw new Error("非私家侦探不能跟踪。");
    if (forcedRoom) throw new Error("被催眠时无法使用跟踪。");
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
  const directMove = !!forcedRoom || !!trackTargetId;
  if (forcedRoom && effectiveToRoom !== forcedRoom && !trackTargetId) {
    throw new Error(`你被催眠，本轮必须前往 ${getRoomLabel(forcedRoom)}。`);
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

  // v1.0.3 §7.2：毒气投票移到行动末尾（确认移动→抽卡→准备→毒气投票→结束）。
  // 提交移动时毒气投票可暂缺，由 reviseAction 在行动末尾补交；endTurn 会校验存活玩家已投票。
  let gasVoteFloor: string | null = null;
  if (isAlive && input.gasVoteFloor) {
    if (!FLOOR_IDS.includes(input.gasVoteFloor)) throw new Error("非法的毒气投票楼层。");
    gasVoteFloor = input.gasVoteFloor;
  }

  // v1.0.4：水、粮、药、果汁、肾上腺素改在结算阶段私密选择，行动阶段提交一律不记录这些资源选择。
  const useItems: string[] = [];

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
    submitWater: undefined,
    submitFood: undefined,
    roleSkill: isAlive ? input.roleSkill : undefined,
    notes: input.notes,
    submittedAt: nowISO(),
  };

  const updated: Player = { ...player, submittedAction: action };
  let next: GameRoom = {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    pendingHypnosis: pendingHypnosis
      ? (room.pendingHypnosis ?? []).map((h) => (h === pendingHypnosis ? { ...h, status: "applied" } : h))
      : room.pendingHypnosis ?? [],
    updatedAt: nowISO(),
  };

  // 处理声明的主动技能（催眠/死亡预告/黑客会改动房间或其他玩家状态）。校验失败会抛错。
  // §13：技能日志写为私密（仅本人可见），不实时公开（如催眠目标不能被他人看到）。
  if (action.roleSkill?.type === "charm") {
    throw new Error("催眠师技能需在行动阶段开始前处理。");
  }
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
    /** 行动末尾补交毒气投票（v1.0.3 §7.2） */
    gasVoteFloor?: string | null;
    /** 仅用于结算时生效的技能（饮品师果汁分配）；移动阶段已生效的技能不在此覆盖 */
    roleSkill?: RoleSkillInput;
  }
): GameRoom {
  if (room.currentPhase !== "ACTION") throw new Error("当前不是行动阶段。");
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !player.submittedAction) throw new Error("请先提交行动。");
  if (player.endedAction) throw new Error("你已结束本轮行动，无法再修改。");
  if (patch.gasVoteFloor != null && !FLOOR_IDS.includes(patch.gasVoteFloor)) {
    throw new Error("非法的毒气投票楼层。");
  }

  const a = player.submittedAction;
  // 仅允许在 reviseAction 更新「果汁」类技能（结算时生效），避免覆盖移动阶段已落地的技能。
  const nextRoleSkill =
    patch.roleSkill !== undefined && (patch.roleSkill === undefined || patch.roleSkill.type === "juice")
      ? patch.roleSkill
      : a.roleSkill;
  const updated: Player = {
    ...player,
    submittedAction: {
      ...a,
      useItems:
        a.useItems ?? [],
      rocketTargetRoom: patch.rocketTargetRoom !== undefined ? patch.rocketTargetRoom : a.rocketTargetRoom,
      submitWater: a.submitWater,
      submitFood: a.submitFood,
      roomAction: patch.roomAction !== undefined ? patch.roomAction : a.roomAction,
      gasVoteFloor: patch.gasVoteFloor !== undefined ? patch.gasVoteFloor : a.gasVoteFloor,
      roleSkill: nextRoleSkill,
    },
  };
  return {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    updatedAt: nowISO(),
  };
}

export function chooseResolutionResources(
  room: GameRoom,
  playerId: string,
  patch: {
    useItems?: string[];
    submitWater?: boolean;
    submitFood?: boolean;
    roleSkill?: RoleSkillInput;
  }
): GameRoom {
  if (room.currentPhase !== "RESOLUTION") throw new Error("仅能在结算阶段选择资源。");
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  if (player.status !== "alive") throw new Error("暗影无需选择结算资源。");
  const a = player.submittedAction ?? {
    round: room.currentRound,
    fromRoom: player.location,
    toRoom: player.location ?? "",
    gasVoteFloor: null,
    submittedAt: nowISO(),
  };
  const availableCounts: Record<string, number> = {};
  for (const id of player.inventory) {
    if (["pill", "juice", "adrenaline"].includes(id)) availableCounts[id] = (availableCounts[id] ?? 0) + 1;
  }
  const usedCounts: Record<string, number> = {};
  const useItems = (patch.useItems ?? []).filter((id) => {
    if (!["pill", "juice", "adrenaline"].includes(id)) return false;
    const nextCount = (usedCounts[id] ?? 0) + 1;
    if (nextCount > (availableCounts[id] ?? 0)) return false;
    usedCounts[id] = nextCount;
    return true;
  });
  if (patch.roleSkill?.type === "juice") validateJuiceSkill(room, player, useItems, patch.roleSkill);
  const nextRoleSkill =
    patch.roleSkill?.type === "juice"
      ? patch.roleSkill
      : patch.roleSkill?.type === "gift"
        ? validateGiftSkill(room, player, patch.roleSkill)
        : a.roleSkill?.type === "gift"
          ? undefined
          : a.roleSkill;
  const updated: Player = {
    ...player,
    submittedAction: {
      ...a,
      useItems,
      submitWater: patch.submitWater,
      submitFood: patch.submitFood,
      roleSkill: nextRoleSkill,
    },
  };
  return markSettlementConfirmed({
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    resolutionPreview: null,
    updatedAt: nowISO(),
  }, playerId);
}

function validateJuiceSkill(room: GameRoom, player: Player, useItems: string[], skill: RoleSkillInput): void {
  const juiceCount = useItems.filter((id) => id === "juice").length;
  if (juiceCount <= 0) return;
  if (player.roleId !== "bartender" || juiceCount <= 1) return;
  const assignments = skill.juiceAssignments ?? [];
  if (assignments.length < juiceCount) throw new Error(`饮品师使用 ${juiceCount} 瓶果汁时，必须选择 ${juiceCount} 个目标。`);
  const targetIds = assignments.slice(0, juiceCount).map((a) => a.targetPlayerId).filter(Boolean);
  if (targetIds.length !== juiceCount) throw new Error(`饮品师使用 ${juiceCount} 瓶果汁时，必须选择 ${juiceCount} 个目标。`);
  const unique = new Set(targetIds);
  if (unique.size !== targetIds.length) throw new Error("饮品师一次使用多瓶果汁时，同一目标不能被使用多瓶。");
  for (const id of targetIds) {
    const target = room.players.find((p) => p.id === id);
    if (!target || target.status !== "alive") throw new Error("果汁目标必须是存活玩家。");
  }
}

function validateGiftSkill(room: GameRoom, player: Player, skill: RoleSkillInput): RoleSkillInput {
  if (player.roleId !== "philanthropist") throw new Error("非慈善家不能使用赠予技能。");
  const targetId = skill.targetPlayerIds?.[0];
  if (!targetId) throw new Error("慈善家若选择使用技能，必须选择赠予对象。");
  const target = room.players.find((p) => p.id === targetId);
  if (!target || target.status !== "alive" || target.id === player.id) throw new Error("慈善家赠予目标非法。");
  if (target.giftedDone) throw new Error("该玩家本局已被慈善家赠予过。");
  if (!skill.giveItemId) throw new Error("慈善家若选择使用技能，必须选择 1 张道具。");
  const idx = skill.giveItemIndex;
  if (idx === undefined || idx < 0 || idx >= player.inventory.length) throw new Error("慈善家必须按单张道具选择。");
  if (player.inventory[idx] !== skill.giveItemId) throw new Error("慈善家选择的道具已变化，请重新选择。");
  return { ...skill, targetPlayerIds: [targetId], giveItemId: skill.giveItemId, giveItemIndex: idx };
}

export function reallocateGenesAtOperationRoom(
  room: GameRoom,
  playerId: string,
  genes: { force: number; speed: number; load: number }
): GameRoom {
  if (room.currentPhase !== "ACTION") throw new Error("仅能在行动阶段使用操作室。");
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  if (player.status !== "alive") throw new Error("暗影不能使用操作室。");
  if (player.endedAction) throw new Error("你已结束本轮行动，无法再使用操作室。");
  const action = player.submittedAction;
  if (!action || action.toRoom !== "B304") throw new Error("你本轮必须停留在 B304 操作室才能重分配基因。");
  if (isRoomFunctionDisabledForAction("B304", room, player)) throw new Error("操作室功能本轮被关闭，无法使用。");
  const force = Math.max(0, Math.floor(genes.force));
  const speed = Math.max(0, Math.floor(genes.speed));
  const load = Math.max(0, Math.floor(genes.load));
  const total = player.force + player.speed + player.load;
  if (speed < 1) throw new Error("速度不能为 0（最低 1）。");
  if (force + speed + load !== total) {
    throw new Error(`操作室只能重新分配当前可用基因总和 ${total} 点。`);
  }
  const updated: Player = { ...player, force, speed, load };
  let next: GameRoom = {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? updated : p)),
    updatedAt: nowISO(),
  };
  next = appendPrivateLog(next, playerId, `你在 ${getRoomLabel("B304")} 重新分配基因为 武力${force}/速度${speed}/负重${load}。`);
  return next;
}

/** 所有已就座玩家是否都已提交（用于行动阶段进度） */
export function allSubmitted(room: GameRoom): boolean {
  const seated = room.players.filter((p) => p.name);
  return seated.length > 0 && seated.every((p) => p.submittedAction);
}
