// 开始游戏。来源：开发指令 8.1。

import type { GameRoom, Inventory, Player } from "../types";
import { appendLog, nowISO } from "./helpers";
import { MAX_SEATS } from "./createGame";
import { isGeneValid, resolveRoleAssignments } from "./lobby";
import { getRole } from "../config/roles";
import { ROOMS } from "../config/rooms";
import { initialStockFor } from "../config/initialStocks";
import { applyRoleSetup } from "./roleEffects";

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
    if (!p.preferredRoleId || !p.location) return { ok: false, reason: `${p.name} 设置不完整。` };
    if (!isGeneValid({ force: p.force, speed: p.speed, load: p.load })) {
      return { ok: false, reason: `${p.name} 基因点不合法。` };
    }
  }
  return { ok: true };
}

/**
 * 开始游戏：
 * 1. 校验；2. 初始化玩家与库存；3. 进入首轮出生战斗结算；4. 确认后才进入正式第 1 轮。
 */
export function startGame(room: GameRoom): GameRoom {
  const check = canStartGame(room);
  if (!check.ok) throw new Error(check.reason ?? "无法开始游戏。");

  // §1：统一解析角色撞车，落定每名玩家最终 roleId（撞车者从剩余角色随机抽取）。
  const assignments = resolveRoleAssignments(room.players);

  const players: Player[] = room.players.map((p) => {
    if (!p.name) return p; // 空座位保持原样
    return {
      ...p,
      roleId: assignments[p.id] ?? p.roleId,
      hp: 10,
      maxHp: 10,
      previousLocation: null,
      // location 已是出生房间
      status: "alive",
      shadowDrainCount: 0,
      lastRoundHp: 10,
      orderCard: null,
      endedAction: false,
      submittedAction: null,
    };
  });

  // 初始化房间库存（规则 14.1 / 开发指令 3.2.3）
  const roomInventories: Record<string, Inventory> = {};
  for (const r of ROOMS) {
    roomInventories[r.id] = initialStockFor(r.id);
  }

  let next: GameRoom = {
    ...room,
    players,
    roomInventories,
    consumedPile: {},
    airdrops: [],
    status: "SPAWN_COMBAT",
    currentRound: 0,
    currentPhase: "SPAWN_COMBAT",
    trades: [],
    closedRooms: [],
    closedRoomRecords: [],
    pendingHypnosis: [],
    hypnosisDecisions: [],
    settlementConfirmations: [],
    updatedAt: nowISO(),
  };

  // 职业开局设置（富豪金条、驯兽师 +1、运行时字段初始化）。规则 3.2。
  const setup = applyRoleSetup(next);
  next = setup.room;
  for (const m of setup.logs) next = appendLog(next, m);

  // §1：角色最终分配完成后公开。
  const roster = next.players
    .filter((p) => p.name)
    .map((p) => `${p.name}=${getRole(p.roleId)?.name ?? "?"}`)
    .join("，");
  next = appendLog(next, `角色分配完成：${roster}。`);
  next = appendLog(next, "出生房间已确定，请房主执行首轮出生战斗结算。");
  return next;
}
