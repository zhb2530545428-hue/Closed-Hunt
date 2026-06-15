// 大厅相关操作：加入座位、设置昵称/职业/基因点/出生房间、准备。
// 来源：开发指令 3.1、4.2、6.3。

import type { GameRoom, Player } from "../types";
import { ROLE_IDS } from "../config/roles";
import { SPAWN_ROOMS } from "../config/spawnRooms";
import { appendLog, shuffle } from "./helpers";

export const GENE_TOTAL = 10;

export interface GeneAllocation {
  force: number;
  speed: number;
  load: number;
}

/** 基因点是否合法：三项非负且总和为 10。来源：规则手册 2.3。 */
export function isGeneValid(g: GeneAllocation): boolean {
  return (
    g.force >= 0 &&
    g.speed >= 0 &&
    g.load >= 0 &&
    g.force + g.speed + g.load === GENE_TOTAL
  );
}

function replacePlayer(room: GameRoom, player: Player): GameRoom {
  return {
    ...room,
    players: room.players.map((p) => (p.id === player.id ? player : p)),
    updatedAt: new Date().toISOString(),
  };
}

/** 加入一个空座位，返回 { room, playerId }。座位满或非大厅阶段抛错。 */
export function joinGame(
  room: GameRoom,
  name: string,
  seatIndex: number
): { room: GameRoom; player: Player } {
  if (room.currentPhase !== "LOBBY") {
    throw new Error("游戏已开始，无法加入。");
  }
  const seat = room.players.find((p) => p.seatIndex === seatIndex);
  if (!seat) throw new Error("座位不存在。");
  if (seat.name) throw new Error("该座位已被占用。");

  const updated: Player = { ...seat, name: name.trim() || `玩家${seatIndex + 1}` };
  return { room: replacePlayer(room, updated), player: updated };
}

/** 设置玩家的昵称、职业、基因点、出生房间（任意子集） */
export function updatePlayerSetup(
  room: GameRoom,
  playerId: string,
  patch: {
    name?: string;
    roleId?: string | null;
    genes?: GeneAllocation;
    spawnRoom?: string;
  }
): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  if (room.currentPhase !== "LOBBY") throw new Error("仅能在大厅修改设置。");

  const updated: Player = { ...player };
  if (patch.name !== undefined) updated.name = patch.name.trim();
  if (patch.roleId !== undefined) updated.roleId = patch.roleId;
  if (patch.genes) {
    updated.force = patch.genes.force;
    updated.speed = patch.genes.speed;
    updated.load = patch.genes.load;
  }
  if (patch.spawnRoom !== undefined) {
    if (!SPAWN_ROOMS.includes(patch.spawnRoom)) throw new Error("非法出生房间。");
    updated.location = patch.spawnRoom;
  }
  // 修改设置后取消准备，避免准备态与设置不一致
  updated.isReady = false;
  return replacePlayer(room, updated);
}

/** 随机分配一个职业 */
export function randomRole(room: GameRoom, playerId: string): GameRoom {
  const roleId = shuffle(ROLE_IDS)[0];
  return updatePlayerSetup(room, playerId, { roleId });
}

/** 切换准备状态。准备前校验昵称、职业、基因点、出生房间齐全。 */
export function toggleReady(room: GameRoom, playerId: string): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");

  if (!player.isReady) {
    if (!player.name) throw new Error("请先填写昵称。");
    if (!player.roleId) throw new Error("请先选择职业。");
    if (!isGeneValid({ force: player.force, speed: player.speed, load: player.load })) {
      throw new Error("基因点三项之和必须为 10。");
    }
    if (!player.location) throw new Error("请先选择出生房间。");
  }
  const updated: Player = { ...player, isReady: !player.isReady };
  let next = replacePlayer(room, updated);
  next = appendLog(
    next,
    `${updated.name} ${updated.isReady ? "已准备" : "取消准备"}。`
  );
  return next;
}

/** 房主重置某玩家座位（清空，便于换人） */
export function kickSeat(room: GameRoom, seatIndex: number): GameRoom {
  if (room.currentPhase !== "LOBBY") throw new Error("仅能在大厅清空座位。");
  const seat = room.players.find((p) => p.seatIndex === seatIndex);
  if (!seat) throw new Error("座位不存在。");
  if (seat.id === room.hostPlayerId) throw new Error("不能清空房主座位。");

  const cleared: Player = {
    ...seat,
    name: "",
    roleId: null,
    force: 0,
    speed: 0,
    load: 0,
    location: null,
    isReady: false,
  };
  return replacePlayer(room, cleared);
}
