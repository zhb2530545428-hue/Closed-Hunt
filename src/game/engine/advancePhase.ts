// 阶段推进与结算应用。来源：规则手册 5-8、17；开发指令 7、8.6、3.5。

import type { GamePhase, GameRoom, Player } from "../types";
import { TOTAL_ROUNDS } from "../config/rounds";
import { appendLog, makeLog, nowISO, shuffle } from "./helpers";
import { addAirdropForRound } from "./draw";
import { buildResolutionPreview, applyFinalGoldConversion } from "../resolution";

/** 进入行动阶段：为存活玩家随机生成顺位卡（规则 6.1） */
function enterAction(room: GameRoom): GameRoom {
  const alive = room.players.filter((p) => p.status === "alive" && p.name);
  const order = shuffle(alive.map((p) => p.id));
  const orderMap = new Map(order.map((id, idx) => [id, idx + 1]));
  const players: Player[] = room.players.map((p) =>
    orderMap.has(p.id) ? { ...p, orderCard: orderMap.get(p.id)! } : { ...p, orderCard: null }
  );
  let next: GameRoom = { ...room, players, currentPhase: "ACTION", status: "ACTION", updatedAt: nowISO() };
  next = appendLog(next, `第 ${room.currentRound} 轮行动阶段开始，已随机生成顺位卡。`);
  return next;
}

function enterFree(room: GameRoom): GameRoom {
  let next: GameRoom = { ...room, currentPhase: "FREE", status: "FREE", updatedAt: nowISO() };
  next = appendLog(next, `第 ${room.currentRound} 轮自由阶段开始。`);
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
  next = appendLog(next, `第 ${room.currentRound} 轮结算阶段开始。`);
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
  next = appendLog(next, `房主生成了第 ${room.currentRound} 轮结算预览。`);
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
  // 追加每一步的公开日志
  const logs = room.resolutionPreview.steps.flatMap((s) =>
    s.logs.map((m) => makeLog(resolved, `[${s.title}] ${m}`))
  );
  let applied: GameRoom = { ...resolved, publicLogs: [...resolved.publicLogs, ...logs] };

  // 2. 第 6 轮结束 → 最终结算
  if (applied.currentRound >= TOTAL_ROUNDS) {
    return finalize(applied);
  }
  // 3. 否则进入下一轮
  return advanceToNextRound(applied);
}

/** 最终结算：金条兑换 + 进入 GAME_OVER。规则 17.2。 */
function finalize(room: GameRoom): GameRoom {
  const { players, logs } = applyFinalGoldConversion(
    room.players.map((p) => ({ ...p, lastRoundHp: p.hp }))
  );
  let next: GameRoom = { ...room, players, currentPhase: "GAME_OVER", status: "GAME_OVER", updatedAt: nowISO() };
  for (const m of logs) next = appendLog(next, m);
  next = appendLog(next, `第 ${TOTAL_ROUNDS} 轮结算完成，游戏结束，进入最终排名。`);
  return next;
}

/** 进入下一轮：移动落地、复活、肾上腺素、清空提交，写日志。规则 8.6 / 13。 */
function advanceToNextRound(room: GameRoom): GameRoom {
  const newRound = room.currentRound + 1;

  const players: Player[] = room.players.map((p) => {
    if (!p.name) return p;
    const np: Player = { ...p, lastRoundHp: p.hp, orderCard: null };

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
    updatedAt: nowISO(),
  };
  next = addAirdropForRound(next, newRound);
  next = appendLog(next, `进入第 ${newRound} 轮，自由阶段开始。`);
  return next;
}

/** 结束游戏（房主强制） */
export function endGame(room: GameRoom): GameRoom {
  let next: GameRoom = { ...room, currentPhase: "GAME_OVER", status: "GAME_OVER", updatedAt: nowISO() };
  next = appendLog(next, "房主结束了游戏。");
  return next;
}
