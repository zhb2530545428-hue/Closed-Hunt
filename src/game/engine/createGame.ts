// 创建房间。来源：开发指令 6.1、8.1。

import type { GameRoom, Player } from "../types";
import { genRoomCode, makeLog, nowISO, uid } from "./helpers";

export const MAX_SEATS = 9;

/** 创建一个空玩家（座位） */
export function makeEmptyPlayer(seatIndex: number): Player {
  return {
    id: uid("p_"),
    name: "",
    seatIndex,
    roleId: null,
    hp: 10,
    maxHp: 10,
    force: 0,
    speed: 0,
    load: 0,
    location: null,
    previousLocation: null,
    status: "alive",
    inventory: [],
    orderCard: null,
    shadowDrainCount: 0,
    isReady: false,
    submittedAction: null,
  };
}

export interface CreateGameOptions {
  hostName: string;
  /** 已存在的房间码集合，避免冲突 */
  existingCodes?: string[];
  devMode?: boolean;
}

/**
 * 创建房间：房主自动落座 0 号座位并成为 host。
 * 返回的房间处于 LOBBY 阶段。
 */
export function createGame(opts: CreateGameOptions): GameRoom {
  let roomCode = genRoomCode();
  const existing = new Set(opts.existingCodes ?? []);
  while (existing.has(roomCode)) roomCode = genRoomCode();

  const host = makeEmptyPlayer(0);
  host.name = opts.hostName.trim() || "房主";

  const room: GameRoom = {
    id: uid("room_"),
    roomCode,
    status: "LOBBY",
    currentRound: 0,
    currentPhase: "LOBBY",
    hostPlayerId: host.id,
    players: [host],
    gasFloors: [],
    clearedGasRooms: [],
    roomInventories: {},
    consumedPile: {},
    airdrops: [],
    resolutionPreview: null,
    publicLogs: [],
    devMode: opts.devMode ?? false,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  room.publicLogs.push(
    makeLog(room, `房间 ${roomCode} 已创建，房主：${host.name}。`)
  );
  return room;
}
