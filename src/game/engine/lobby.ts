// 大厅相关操作：加入座位、设置昵称/职业/基因点/出生房间、准备。
// 来源：开发指令 3.1、4.2、6.3。

import type { GameRoom, Player } from "../types";
import { ROLE_IDS } from "../config/roles";
import { SPAWN_ROOMS } from "../config/spawnRooms";
import { appendLog, shuffle } from "./helpers";

export const GENE_TOTAL = 10;

/**
 * 角色撞车解析（规则见 v1.0.1 §1）：玩家私下选择 preferredRoleId，互相不可见。
 * - 仅 1 人选某角色 → 该玩家锁定该角色；
 * - 2 人及以上选同一角色（或未选） → 全部进入同一撞车池，统一从「未被唯一锁定的角色」中无放回随机抽取；
 * - 多组撞车合并为同一池统一抽取，保证最终人人唯一。
 * 返回 playerId -> roleId 的最终分配（仅含在座玩家）。
 */
export function resolveRoleAssignments(
  players: Player[],
  allRoleIds: string[] = ROLE_IDS
): Record<string, string> {
  const seated = players.filter((p) => p.name);

  // 按非空 preferredRoleId 分组
  const byRole = new Map<string, Player[]>();
  const noPref: Player[] = [];
  for (const p of seated) {
    if (!p.preferredRoleId) {
      noPref.push(p);
      continue;
    }
    if (!byRole.has(p.preferredRoleId)) byRole.set(p.preferredRoleId, []);
    byRole.get(p.preferredRoleId)!.push(p);
  }

  const locked: Record<string, string> = {};
  const usedRoles = new Set<string>();
  const collisionPlayers: Player[] = [...noPref];

  for (const [roleId, group] of byRole) {
    if (group.length === 1 && allRoleIds.includes(roleId)) {
      locked[group[0].id] = roleId;
      usedRoles.add(roleId);
    } else {
      collisionPlayers.push(...group);
    }
  }

  const available = shuffle(allRoleIds.filter((r) => !usedRoles.has(r)));
  const pool = shuffle(collisionPlayers);
  pool.forEach((p, i) => {
    if (available[i]) locked[p.id] = available[i];
  });

  return locked;
}

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
  // §1：准备阶段只记录「想选的角色」preferredRoleId（互相不可见），开局再统一解析为 roleId。
  if (patch.roleId !== undefined) updated.preferredRoleId = patch.roleId;
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

/** 随机选择一个想要的角色（写入 preferredRoleId） */
export function randomRole(room: GameRoom, playerId: string): GameRoom {
  const roleId = shuffle(ROLE_IDS)[0];
  return updatePlayerSetup(room, playerId, { roleId });
}

/** 切换准备状态。准备前校验昵称、(想选)职业、基因点、出生房间齐全。 */
export function toggleReady(room: GameRoom, playerId: string): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");

  if (!player.isReady) {
    if (!player.name) throw new Error("请先填写昵称。");
    if (!player.preferredRoleId) throw new Error("请先选择想要的角色。");
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
    preferredRoleId: null,
    roleId: null,
    force: 0,
    speed: 0,
    load: 0,
    location: null,
    isReady: false,
  };
  return replacePlayer(room, cleared);
}
