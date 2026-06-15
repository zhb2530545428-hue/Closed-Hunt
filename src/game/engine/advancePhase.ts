// 阶段推进。来源：规则手册 5-8；开发指令 7、8.6。
// 房主控制台通过这些函数推进游戏；所有推进都写公开日志。

import type { GamePhase, GameRoom, Player } from "../types";
import { TOTAL_ROUNDS } from "../config/rounds";
import { appendLog, nowISO, shuffle } from "./helpers";
import { buildResolution, allStepsConfirmed } from "./resolveRound";

/** 进入行动阶段：为存活玩家随机生成顺位卡（规则 6.1） */
function enterAction(room: GameRoom): GameRoom {
  const alive = room.players.filter((p) => p.status === "alive" && p.name);
  const order = shuffle(alive.map((p) => p.id));
  const orderMap = new Map(order.map((id, idx) => [id, idx + 1]));

  const players: Player[] = room.players.map((p) =>
    orderMap.has(p.id)
      ? { ...p, orderCard: orderMap.get(p.id)! }
      : { ...p, orderCard: null }
  );

  let next: GameRoom = {
    ...room,
    players,
    currentPhase: "ACTION",
    status: "ACTION",
    updatedAt: nowISO(),
  };
  next = appendLog(next, `第 ${room.currentRound} 轮行动阶段开始，已随机生成顺位卡。`);
  return next;
}

/** 进入自由阶段 */
function enterFree(room: GameRoom): GameRoom {
  let next: GameRoom = {
    ...room,
    currentPhase: "FREE",
    status: "FREE",
    updatedAt: nowISO(),
  };
  next = appendLog(next, `第 ${room.currentRound} 轮自由阶段开始。`);
  return next;
}

/**
 * 房主显式切换阶段（控制台按钮）。
 * 仅允许在同一轮内的相邻切换；进入下一轮请用 nextRound()。
 */
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
      return buildResolution(room);
    default:
      throw new Error("不支持切换到该阶段。");
  }
}

/**
 * 进入下一轮 / 结束游戏。来源：开发指令 8.6。
 * 要求当前处于 RESOLUTION 且 8 个结算步骤全部确认。
 */
export function nextRound(room: GameRoom): GameRoom {
  if (room.currentPhase !== "RESOLUTION") throw new Error("仅能在结算阶段后进入下一轮。");
  if (!allStepsConfirmed(room)) throw new Error("请先确认全部 8 个结算步骤。");

  // 第 6 轮结束 → 游戏结束
  if (room.currentRound >= TOTAL_ROUNDS) {
    let next: GameRoom = {
      ...room,
      currentPhase: "GAME_OVER",
      status: "GAME_OVER",
      updatedAt: nowISO(),
    };
    next = appendLog(next, `第 ${TOTAL_ROUNDS} 轮结算完成，游戏结束，进入最终排名。`);
    return next;
  }

  // 第 1-5 轮：进入下一轮自由阶段，清空提交与顺位卡
  const players: Player[] = room.players.map((p) => ({
    ...p,
    previousLocation: p.location,
    location: p.submittedAction?.toRoom ?? p.location,
    submittedAction: null,
    orderCard: null,
  }));

  let next: GameRoom = {
    ...room,
    players,
    currentRound: room.currentRound + 1,
    currentPhase: "FREE",
    status: "FREE",
    resolutionSteps: [],
    updatedAt: nowISO(),
  };
  next = appendLog(next, `进入第 ${next.currentRound} 轮，自由阶段开始。`);
  return next;
}

/** 确认 / 取消确认某个结算步骤，可附主持人备注 */
export function setResolutionStep(
  room: GameRoom,
  key: string,
  patch: { confirmed?: boolean; hostNotes?: string }
): GameRoom {
  const steps = room.resolutionSteps.map((s) =>
    s.key === key
      ? {
          ...s,
          confirmed: patch.confirmed ?? s.confirmed,
          hostNotes: patch.hostNotes ?? s.hostNotes,
          status: (patch.confirmed ?? s.confirmed) ? ("confirmed" as const) : s.status,
        }
      : s
  );
  return { ...room, resolutionSteps: steps, updatedAt: nowISO() };
}

/** 结束游戏（房主强制） */
export function endGame(room: GameRoom): GameRoom {
  let next: GameRoom = {
    ...room,
    currentPhase: "GAME_OVER",
    status: "GAME_OVER",
    updatedAt: nowISO(),
  };
  next = appendLog(next, "房主结束了游戏。");
  return next;
}
