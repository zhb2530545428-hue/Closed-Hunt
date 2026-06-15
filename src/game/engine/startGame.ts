// 开始游戏。来源：开发指令 8.1。

import type { GameRoom, Player } from "../types";
import { appendLog, nowISO } from "./helpers";
import { MAX_SEATS } from "./createGame";
import { isGeneValid } from "./lobby";

/** 已就座（有昵称）的玩家 */
function seatedPlayers(room: GameRoom): Player[] {
  return room.players.filter((p) => p.name);
}

/**
 * 校验是否可以开始游戏。
 * 正式局需 9 名玩家全部准备；devMode 下允许少于 9 人但所有已就座玩家须准备。
 */
export function canStartGame(room: GameRoom): { ok: boolean; reason?: string } {
  if (room.currentPhase !== "LOBBY") return { ok: false, reason: "游戏已开始。" };
  const seated = seatedPlayers(room);
  if (seated.length === 0) return { ok: false, reason: "没有玩家。" };

  if (!room.devMode && seated.length < MAX_SEATS) {
    return { ok: false, reason: `正式局需 ${MAX_SEATS} 名玩家（当前 ${seated.length}）。` };
  }
  const notReady = seated.filter((p) => !p.isReady);
  if (notReady.length > 0) {
    return { ok: false, reason: `仍有 ${notReady.length} 名玩家未准备。` };
  }
  for (const p of seated) {
    if (!p.roleId || !p.location) return { ok: false, reason: `${p.name} 设置不完整。` };
    if (!isGeneValid({ force: p.force, speed: p.speed, load: p.load })) {
      return { ok: false, reason: `${p.name} 基因点不合法。` };
    }
  }
  return { ok: true };
}

/**
 * 开始游戏：
 * 1. 校验；2. 初始化第 1 轮；3. 玩家位置=出生房间，生命=10；4. 进入 FREE 阶段。
 */
export function startGame(room: GameRoom): GameRoom {
  const check = canStartGame(room);
  if (!check.ok) throw new Error(check.reason ?? "无法开始游戏。");

  const players: Player[] = room.players.map((p) => {
    if (!p.name) return p; // 空座位保持原样
    return {
      ...p,
      hp: 10,
      maxHp: 10,
      previousLocation: null,
      // location 已是出生房间
      status: "alive",
      shadowDrainCount: 0,
      orderCard: null,
      submittedAction: null,
    };
  });

  let next: GameRoom = {
    ...room,
    players,
    status: "FREE",
    currentRound: 1,
    currentPhase: "FREE",
    updatedAt: nowISO(),
  };
  next = appendLog(next, "游戏开始。第 1 轮自由阶段开始。");
  return next;
}
