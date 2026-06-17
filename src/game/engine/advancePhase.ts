// 阶段推进与结算应用。来源：规则手册 5-8、17；开发指令 7、8.6、3.5。

import type { GamePhase, GameRoom, Player } from "../types";
import { TOTAL_ROUNDS, formatRoundLabel } from "../config/rounds";
import { appendLog, appendHostLog, makeLog, nowISO, shuffle } from "./helpers";
import { addAirdropForRound } from "./draw";
import { isDrawRoom, isRoomFunctionAvailable } from "../config/roomFunctions";
import { buildResolutionPreview, applyFinalGoldConversion } from "../resolution";

/** 为存活在座玩家随机生成顺位卡（规则 6.1，自由阶段抽取，可在自由阶段交易）。 */
export function assignOrderCards(room: GameRoom): GameRoom {
  const alive = room.players.filter((p) => p.status === "alive" && p.name);
  const order = shuffle(alive.map((p) => p.id));
  const orderMap = new Map(order.map((id, idx) => [id, idx + 1]));
  const players: Player[] = room.players.map((p) =>
    orderMap.has(p.id) ? { ...p, orderCard: orderMap.get(p.id)! } : { ...p, orderCard: null }
  );
  return { ...room, players, updatedAt: nowISO() };
}

/** 进入行动阶段：顺位卡已在自由阶段抽取；缺失则补发；清除上一阶段的「已结束行动」。 */
function enterAction(room: GameRoom): GameRoom {
  let base = room;
  const aliveNoCard = room.players.some((p) => p.status === "alive" && p.name && p.orderCard == null);
  if (aliveNoCard) base = assignOrderCards(room);
  // §7：每次进入行动阶段重置「已结束行动」标记，确保按顺位重新行动。
  const players = base.players.map((p) => ({ ...p, endedAction: false }));
  let next: GameRoom = { ...base, players, currentPhase: "ACTION", status: "ACTION", updatedAt: nowISO() };
  next = appendLog(next, `${formatRoundLabel(room.currentRound)}行动阶段开始，按顺位卡依次行动。`);
  return next;
}

/**
 * 当前应行动的玩家 id（§7 严格顺位）：本轮存活、在座、有顺位卡、尚未结束行动者中，
 * 顺位卡数字最小者。全部结束行动或无人可行动时返回 null。
 */
export function currentTurnPlayerId(room: GameRoom): string | null {
  const pending = room.players.filter(
    (p) => p.name && p.status === "alive" && p.orderCard != null && !p.endedAction
  );
  if (pending.length === 0) return null;
  pending.sort((a, b) => (a.orderCard ?? 0) - (b.orderCard ?? 0));
  return pending[0].id;
}

/**
 * 结束本轮行动（§7 两段式收尾）：仅当前顺位玩家、已提交移动后可调用；
 * 调用后整轮锁定不可再改，轮到下一顺位。对外仅公开「已完成行动」这一非敏感信息（§13）。
 */
export function endTurn(room: GameRoom, playerId: string): GameRoom {
  if (room.currentPhase !== "ACTION") throw new Error("当前不是行动阶段。");
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  if (player.endedAction) throw new Error("你已结束本轮行动。");
  const turnId = currentTurnPlayerId(room);
  if (player.orderCard != null && turnId && turnId !== playerId) throw new Error("还没轮到你行动。");
  if (player.status === "alive" && !player.submittedAction) {
    throw new Error("请先提交本轮移动再结束行动。");
  }
  // §7.2：存活玩家必须先完成毒气投票（行动末尾）才能结束行动。
  if (player.status === "alive" && player.submittedAction && player.submittedAction.gasVoteFloor == null) {
    throw new Error("请先完成毒气投票再结束行动。");
  }
  // §3 强制抽卡确认：若停留在可抽卡房间、本轮该房间仍可抽卡（未被黑客关闭、仍有库存），
  // 必须先抽卡或显式放弃抽卡，才能结束行动，防止玩家遗漏抽卡。
  if (player.status === "alive" && player.submittedAction) {
    const a = player.submittedAction;
    const dest = a.toRoom;
    const closed = !isRoomFunctionAvailable(dest, room);
    const stock = Object.values(room.roomInventories[dest] ?? {}).reduce((s, n) => s + n, 0);
    if (isDrawRoom(dest) && !closed && stock > 0 && !a.hasDrawnFromRoom && !a.drawSkipped) {
      throw new Error("你停留在可抽卡房间，请先抽卡或选择「放弃抽卡」再结束行动。");
    }
  }
  const players = room.players.map((p) => (p.id === playerId ? { ...p, endedAction: true } : p));
  let next: GameRoom = { ...room, players, updatedAt: nowISO() };
  // §4.1：行动阶段「谁已完成行动」属裁判进度信息，不进公开日志（公开看板不显示行动完成提示）。
  next = appendHostLog(next, `${player.name} 已完成行动。`);
  return next;
}

function enterFree(room: GameRoom): GameRoom {
  let next = assignOrderCards(room);
  next = { ...next, currentPhase: "FREE", status: "FREE", trades: [], closedRooms: [], updatedAt: nowISO() };
  next = appendLog(next, `${formatRoundLabel(room.currentRound)}自由阶段开始，已抽取顺位卡，可在本阶段交易。`);
  return next;
}

/** 进入结算阶段（仅切换阶段并清空旧预览，预览由房主显式生成） */
function enterResolution(room: GameRoom): GameRoom {
  let next: GameRoom = {
    ...room,
    currentPhase: "RESOLUTION",
    status: "RESOLUTION",
    resolutionPreview: null,
    updatedAt: nowISO(),
  };
  next = appendLog(next, `${formatRoundLabel(room.currentRound)}结算阶段开始。`);
  return next;
}

/** 房主显式切换阶段（同一轮内相邻切换） */
export function goToPhase(room: GameRoom, target: GamePhase): GameRoom {
  if (room.currentPhase === "LOBBY" || room.currentPhase === "GAME_OVER") {
    throw new Error("当前阶段无法手动切换。");
  }
  switch (target) {
    case "FREE":
      return enterFree(room);
    case "ACTION":
      return enterAction(room);
    case "RESOLUTION":
      return enterResolution(room);
    default:
      throw new Error("不支持切换到该阶段。");
  }
}

/** 生成结算预览（不修改真实状态，仅供房主核对）。开发指令 3.5.2。 */
export function generateResolutionPreview(room: GameRoom): GameRoom {
  if (room.currentPhase !== "RESOLUTION") throw new Error("仅能在结算阶段生成预览。");
  const preview = buildResolutionPreview(room);
  let next: GameRoom = { ...room, resolutionPreview: preview, updatedAt: nowISO() };
  next = appendLog(next, `房主生成了${formatRoundLabel(room.currentRound)}结算预览。`);
  return next;
}

/**
 * 确认应用结算：把预览结果写入真实状态、追加结算日志，
 * 随后进入下一轮（或第 6 轮后进入最终结算）。开发指令 3.5.2 / 8.6。
 */
export function confirmResolution(room: GameRoom): GameRoom {
  if (room.currentPhase !== "RESOLUTION") throw new Error("当前不是结算阶段。");
  if (!room.resolutionPreview) throw new Error("请先生成结算预览。");

  // 1. 应用预览得到的结算后状态
  const resolved: GameRoom = {
    ...room.resolutionPreview.nextRoom,
    resolutionPreview: null,
    updatedAt: nowISO(),
  };
  // 追加每一步的日志，按可见性分发（§4 三层视图）：
  // logs → 公开；hostLogs → 房主裁判；privateLogs → 对应玩家私密。
  const logs = room.resolutionPreview.steps.flatMap((s) => [
    ...s.logs.map((m) => makeLog(resolved, `[${s.title}] ${m}`, "public")),
    ...(s.hostLogs ?? []).map((m) => makeLog(resolved, `[${s.title}] ${m}`, "host")),
    ...(s.privateLogs ?? []).map((pl) => makeLog(resolved, `[${s.title}] ${pl.text}`, "private", pl.playerId)),
  ]);
  let applied: GameRoom = { ...resolved, publicLogs: [...resolved.publicLogs, ...logs] };

  // 2. 提前结束判定（规则 17.1 / 17.4）
  const seated = applied.players.filter((p) => p.name);
  const aliveCount = seated.filter((p) => p.status === "alive").length;
  if (aliveCount <= 1) {
    const winner = seated.find((p) => p.status === "alive");
    applied = appendLog(
      applied,
      winner ? `仅剩 1 名存活玩家 ${winner.name}，立即获胜，游戏结束。` : "所有玩家均已成为暗影，游戏结束。"
    );
    return finalize(applied);
  }

  // 3. 第 6 轮结束 → 最终结算
  if (applied.currentRound >= TOTAL_ROUNDS) {
    return finalize(applied);
  }
  // 4. 否则进入下一轮
  return advanceToNextRound(applied);
}

/** 最终结算：金条兑换 + 进入 GAME_OVER。规则 17.2。 */
function finalize(room: GameRoom): GameRoom {
  const { players, logs } = applyFinalGoldConversion(
    room.players.map((p) => ({ ...p, lastRoundHp: p.hp }))
  );
  let next: GameRoom = { ...room, players, currentPhase: "GAME_OVER", status: "GAME_OVER", updatedAt: nowISO() };
  for (const m of logs) next = appendLog(next, m);
  next = appendLog(next, `${formatRoundLabel(TOTAL_ROUNDS)}结算完成，游戏结束，进入最终排名。`);
  return next;
}

/** 进入下一轮：移动落地、复活、肾上腺素、清空提交，写日志。规则 8.6 / 13。 */
function advanceToNextRound(room: GameRoom): GameRoom {
  const newRound = room.currentRound + 1;

  const players: Player[] = room.players.map((p) => {
    if (!p.name) return p;
    // 每轮重置职业的本轮临时状态（被催眠强制房间、死亡预告标记）与行动锁
    const np: Player = { ...p, lastRoundHp: p.hp, orderCard: null, forcedRoom: null, forecastedBy: [], endedAction: false };
    // §7.1 水粮预交结转：本轮行动末尾对「下一轮」的预交选择，结转为新一轮结算时的待上交标记。
    np.waterPledged = !!p.submittedAction?.submitWater;
    np.foodPledged = !!p.submittedAction?.submitFood;

    // 复活生效（规则 13.5/13.6）
    if (np.reviveNextRound && np.lastDrainRoomId) {
      np.status = "alive";
      np.hp = np.shadowDrainCount;
      np.previousLocation = np.lastDrainRoomId;
      np.location = np.lastDrainRoomId;
      np.shadowDrainCount = 0;
      np.reviveNextRound = false;
      np.submittedAction = null;
    } else if (np.submittedAction?.toRoom) {
      // 正常移动落地
      np.previousLocation = np.location;
      np.location = np.submittedAction.toRoom;
    } else {
      // 未提交移动（如本轮新变暗影，从 B701 出发）
      np.previousLocation = np.location;
    }
    np.submittedAction = null;

    // 肾上腺素：先恢复过期效果，再激活新效果（规则 15.1）
    if (np.adrenalineActiveRound !== undefined && np.adrenalineActiveRound < newRound) {
      if (np.baseSpeedBeforeAdrenaline !== undefined) np.speed = np.baseSpeedBeforeAdrenaline;
      np.adrenalineActiveRound = undefined;
      np.baseSpeedBeforeAdrenaline = undefined;
    }
    if (np.pendingAdrenalineRound === newRound) {
      np.baseSpeedBeforeAdrenaline = np.speed;
      np.speed = 10;
      np.adrenalineActiveRound = newRound;
      np.pendingAdrenalineRound = undefined;
    }
    return np;
  });

  let next: GameRoom = {
    ...room,
    players,
    currentRound: newRound,
    currentPhase: "FREE",
    status: "FREE",
    trades: [], // 新一轮清空上一轮交易
    closedRooms: [], // 黑客关闭的房间仅持续本轮
    updatedAt: nowISO(),
  };
  next = assignOrderCards(next); // 自由阶段抽取顺位卡（规则 6.1）
  next = addAirdropForRound(next, newRound);
  next = appendLog(next, `进入${formatRoundLabel(newRound)}，自由阶段开始，已抽取顺位卡。`);
  return next;
}

/** 结束游戏（房主强制） */
export function endGame(room: GameRoom): GameRoom {
  let next: GameRoom = { ...room, currentPhase: "GAME_OVER", status: "GAME_OVER", updatedAt: nowISO() };
  next = appendLog(next, "房主结束了游戏。");
  return next;
}
