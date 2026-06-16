// 引擎共用辅助函数

import type { GameLog, GamePhase, GameRoom, Player } from "../types";

export function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 生成 6 位大写房间码（去除易混淆字符） */
export function genRoomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** 创建一条公开日志 */
export function makeLog(
  room: GameRoom,
  message: string,
  visibility: "public" | "private" = "public",
  playerId?: string
): GameLog {
  return {
    id: uid("log_"),
    round: room.currentRound,
    phase: room.currentPhase,
    visibility,
    playerId,
    message,
    createdAt: nowISO(),
  };
}

/** 向房间追加【公开】日志并更新时间戳，返回新房间对象 */
export function appendLog(room: GameRoom, ...messages: string[]): GameRoom {
  const logs = messages.map((m) => makeLog(room, m, "public"));
  return {
    ...room,
    publicLogs: [...room.publicLogs, ...logs],
    updatedAt: nowISO(),
  };
}

/**
 * 追加【私密】日志（仅该玩家本人可见，行动阶段不对外公开）。
 * 来源：v1.0.1 §13（公开日志延迟到结算后展示）。
 * 与公开日志同存于 publicLogs 数组，靠 visibility 字段区分；展示层按 visibility 过滤。
 */
export function appendPrivateLog(
  room: GameRoom,
  playerId: string,
  ...messages: string[]
): GameRoom {
  const logs = messages.map((m) => makeLog(room, m, "private", playerId));
  return {
    ...room,
    publicLogs: [...room.publicLogs, ...logs],
    updatedAt: nowISO(),
  };
}

export function alivePlayers(room: GameRoom): Player[] {
  return room.players.filter((p) => p.status === "alive");
}

/** Fisher-Yates 洗牌 */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 是否为某阶段（防止 phase / status 不一致带来的判断分散） */
export function isPhase(room: GameRoom, phase: GamePhase): boolean {
  return room.currentPhase === phase;
}
