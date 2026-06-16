// 房主手动修正操作。来源：开发指令 7、4.4。
// v0.1 规则复杂，房主需要能手动调整状态以便真实试玩。

import type { GameRoom, Player, PlayerStatus } from "../types";
import { appendLog, nowISO } from "./helpers";
import { ROOM_IDS, getRoomLabel } from "../config/rooms";
import { FLOOR_IDS, getFloorLabel } from "../config/floors";
import { getItem, getItemName } from "../config/items";

function replacePlayer(room: GameRoom, player: Player): GameRoom {
  return {
    ...room,
    players: room.players.map((p) => (p.id === player.id ? player : p)),
    updatedAt: nowISO(),
  };
}

function findPlayer(room: GameRoom, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new Error("玩家不存在。");
  return p;
}

/** 手动调整玩家生命值（delta 可正可负），限制在 [0, maxHp]。 */
export function adjustHp(room: GameRoom, playerId: string, delta: number): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  const hp = Math.max(0, Math.min(player.maxHp, player.hp + delta));
  const updated: Player = { ...player, hp };
  let next = replacePlayer(room, updated);
  next = appendLog(
    next,
    `房主调整 ${player.name} 生命值：${player.hp} → ${hp}。`
  );
  return next;
}

/** 手动设置玩家状态（存活 / 暗影） */
export function setPlayerStatus(
  room: GameRoom,
  playerId: string,
  status: PlayerStatus
): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  const updated: Player = { ...player, status };
  let next = replacePlayer(room, updated);
  next = appendLog(
    next,
    `房主将 ${player.name} 设为${status === "shadow" ? "暗影" : "存活"}。`
  );
  return next;
}

/** 手动设置玩家位置（纠错） */
export function setPlayerLocation(room: GameRoom, playerId: string, roomId: string): GameRoom {
  const player = findPlayer(room, playerId);
  if (!ROOM_IDS.includes(roomId)) throw new Error("非法房间。");
  const updated: Player = { ...player, location: roomId };
  let next = replacePlayer(room, updated);
  next = appendLog(next, `[房主] 将 ${player.name} 位置改为 ${getRoomLabel(roomId)}。`);
  return next;
}

/** 手动设置玩家基因点（纠错） */
export function setPlayerGenes(
  room: GameRoom,
  playerId: string,
  genes: { force: number; speed: number; load: number }
): GameRoom {
  const player = findPlayer(room, playerId);
  const force = Math.max(0, Math.floor(genes.force));
  const speed = Math.max(0, Math.floor(genes.speed));
  const load = Math.max(0, Math.floor(genes.load));
  const updated: Player = { ...player, force, speed, load };
  let next = replacePlayer(room, updated);
  next = appendLog(next, `[房主] 设定 ${player.name} 基因：武力${force}/速度${speed}/负重${load}。`);
  return next;
}

/** 给玩家增减一张道具（纠错；delta=+1 或 -1） */
export function adjustPlayerItem(room: GameRoom, playerId: string, itemId: string, delta: number): GameRoom {
  const player = findPlayer(room, playerId);
  if (!getItem(itemId)) throw new Error("未知道具。");
  const inventory = [...player.inventory];
  if (delta > 0) {
    inventory.push(itemId);
  } else {
    const idx = inventory.indexOf(itemId);
    if (idx === -1) throw new Error("玩家未持有该道具。");
    inventory.splice(idx, 1);
  }
  const updated: Player = { ...player, inventory };
  let next = replacePlayer(room, updated);
  next = appendLog(next, `[房主] ${delta > 0 ? "给予" : "移除"} ${player.name} 1 张${getItemName(itemId)}。`);
  return next;
}

/** 设置玩家顺位卡（意见领袖/预言家「决定顺位」或纠错） */
export function setOrderCard(room: GameRoom, playerId: string, order: number | null): GameRoom {
  const player = findPlayer(room, playerId);
  const updated: Player = { ...player, orderCard: order };
  let next = replacePlayer(room, updated);
  next = appendLog(next, `[房主] 设定 ${player.name} 顺位卡为 ${order ?? "无"}。`);
  return next;
}

/** 调整职业技能已用次数（纠错） */
export function adjustRoleUses(room: GameRoom, playerId: string, delta: number): GameRoom {
  const player = findPlayer(room, playerId);
  const roleUses = Math.max(0, (player.roleUses ?? 0) + delta);
  const updated: Player = { ...player, roleUses };
  let next = replacePlayer(room, updated);
  next = appendLog(next, `[房主] 调整 ${player.name} 技能次数为 ${roleUses}。`);
  return next;
}

/** 切换某楼层毒气状态（纠错） */
export function toggleGasFloor(room: GameRoom, floorId: string): GameRoom {
  if (!FLOOR_IDS.includes(floorId)) throw new Error("非法楼层。");
  const has = room.gasFloors.includes(floorId);
  const gasFloors = has ? room.gasFloors.filter((f) => f !== floorId) : [...room.gasFloors, floorId];
  let next: GameRoom = { ...room, gasFloors, updatedAt: nowISO() };
  next = appendLog(next, `[房主] ${has ? "移除" : "添加"} ${getFloorLabel(floorId)} 毒气楼层。`);
  return next;
}

/** 切换某房间解毒状态（纠错；控制室解毒） */
export function toggleClearedRoom(room: GameRoom, roomId: string): GameRoom {
  if (!ROOM_IDS.includes(roomId)) throw new Error("非法房间。");
  const has = room.clearedGasRooms.includes(roomId);
  const clearedGasRooms = has ? room.clearedGasRooms.filter((r) => r !== roomId) : [...room.clearedGasRooms, roomId];
  let next: GameRoom = { ...room, clearedGasRooms, updatedAt: nowISO() };
  next = appendLog(next, `[房主] ${has ? "取消" : "标记"} ${getRoomLabel(roomId)} 解毒。`);
  return next;
}

/** 设置房间库存某道具数量（纠错） */
export function setRoomStock(room: GameRoom, roomId: string, itemId: string, count: number): GameRoom {
  if (!ROOM_IDS.includes(roomId)) throw new Error("非法房间。");
  if (!getItem(itemId)) throw new Error("未知道具。");
  const inv = { ...(room.roomInventories[roomId] ?? {}) };
  const n = Math.max(0, Math.floor(count));
  if (n === 0) delete inv[itemId];
  else inv[itemId] = n;
  let next: GameRoom = {
    ...room,
    roomInventories: { ...room.roomInventories, [roomId]: inv },
    updatedAt: nowISO(),
  };
  next = appendLog(next, `[房主] 设定 ${getRoomLabel(roomId)} 的${getItemName(itemId)}库存为 ${n}。`);
  return next;
}

/** 手动添加一条公开日志 */
export function addPublicLog(room: GameRoom, message: string): GameRoom {
  const msg = message.trim();
  if (!msg) return room;
  return appendLog(room, `[房主] ${msg}`);
}
