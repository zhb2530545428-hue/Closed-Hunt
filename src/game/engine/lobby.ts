// 大厅相关操作：加入座位、设置昵称/职业/基因点/出生房间、准备。
// 来源：开发指令 3.1、4.2、6.3。

import type { GameRoom, Player } from "../types";
import { ROLE_IDS, getRole } from "../config/roles";
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

/**
 * 基因点是否合法（可准备 / 可开始）。来源：规则手册 2.3 + v1.0.3 §5.1/§5.2：
 * 三项非负、总和恰为 10、且速度至少为 1（速度永远不能为 0）。
 */
export function isGeneValid(g: GeneAllocation): boolean {
  return (
    g.force >= 0 &&
    g.speed >= 1 &&
    g.load >= 0 &&
    g.force + g.speed + g.load === GENE_TOTAL
  );
}

/**
 * 初始基因分配校验（v1.0.3 §5.1/§5.2），给出可读原因，供 UI 提交准备前校验。
 * - 三项非负；速度 ≥ 1（速度永远不能为 0）；
 * - 三项总和不能超过 10（硬上限）；需恰好等于 10 才可准备。
 */
export function validateInitialGenes(g: GeneAllocation): { ok: boolean; reason?: string } {
  if (g.force < 0 || g.speed < 0 || g.load < 0) return { ok: false, reason: "基因点不能为负。" };
  if (g.force + g.speed + g.load > GENE_TOTAL) return { ok: false, reason: `三项之和不能超过 ${GENE_TOTAL}。` };
  if (g.speed < 1) return { ok: false, reason: "速度不能为 0（最低 1）。" };
  if (g.force + g.speed + g.load !== GENE_TOTAL) return { ok: false, reason: `三项之和需恰为 ${GENE_TOTAL}。` };
  return { ok: true };
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
    const geneCheck = validateInitialGenes({ force: player.force, speed: player.speed, load: player.load });
    if (!geneCheck.ok) throw new Error(geneCheck.reason!);
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

/** 随机把 GENE_TOTAL 点分到三项（每项 ≥0，和为 10，速度至少 1）。v1.0.3 §5.1。 */
function randomGenes(): GeneAllocation {
  // 速度 1..GENE_TOTAL，保证永不为 0；其余点随机分给武力 / 负重。
  const speed = 1 + Math.floor(Math.random() * GENE_TOTAL);
  const remaining = GENE_TOTAL - speed;
  const force = Math.floor(Math.random() * (remaining + 1));
  const load = remaining - force;
  return { force, speed, load };
}

/**
 * 本地热座 / 房主调试：一键填充至 9 名「已准备」的测试玩家（v1.0.2 §9）。
 * 仅供本地测试 / 房主调试使用，UI 只在本地热座模式暴露，不对正式线上普通玩家开放。
 * - 不覆盖已就座玩家的昵称；为所有就座/空座补齐唯一角色、合法基因点、合法出生房间并置为已准备；
 * - 角色唯一：从未被已就座玩家占用的角色池中随机不放回分配（池 > 9 时自然取到 9 个不同角色）；
 * - 初始生命值与顺位卡在 startGame 时按规则初始化（规则 2.2 / 6.1）。
 */
export function fillTestPlayers(room: GameRoom): GameRoom {
  if (room.currentPhase !== "LOBBY") throw new Error("仅能在大厅填充测试玩家。");
  const seated = room.players.filter((p) => p.name);
  const usedRoles = new Set(seated.map((p) => p.preferredRoleId).filter((r): r is string => !!r));
  const rolePool = shuffle(ROLE_IDS.filter((r) => !usedRoles.has(r)));
  let roleIdx = 0;

  const players: Player[] = room.players.map((p) => {
    const name = p.name || `测试${p.seatIndex + 1}`;
    let preferredRoleId = p.preferredRoleId;
    if (!preferredRoleId) {
      preferredRoleId = rolePool[roleIdx] ?? ROLE_IDS[roleIdx % ROLE_IDS.length];
      roleIdx++;
    }
    const geneOk = isGeneValid({ force: p.force, speed: p.speed, load: p.load });
    const genes = geneOk ? { force: p.force, speed: p.speed, load: p.load } : randomGenes();
    const location = p.location ?? shuffle(SPAWN_ROOMS)[0];
    return {
      ...p,
      name,
      preferredRoleId,
      force: genes.force,
      speed: genes.speed,
      load: genes.load,
      location,
      isReady: true,
    };
  });

  let next: GameRoom = { ...room, players, updatedAt: new Date().toISOString() };
  next = appendLog(next, `[本地测试] 已随机填充 9 名测试玩家（角色唯一）并全部准备就绪。`);
  return next;
}

/**
 * 本地热座 / 房主调试：随机生成「1 名」测试玩家填入首个空座（v1.0.3 §8）。
 * 自动分配随机测试昵称、未被占用的唯一角色、合法初始属性（速度 ≥1、和为 10）、合法出生房间，并置为已准备。
 * - 座位已满（9 人）则抛错；无可用唯一角色则抛错。
 * 仅供本地测试 / 房主调试，UI 只在本地热座模式暴露，不对正式线上普通玩家开放。
 */
export function addRandomTestPlayer(room: GameRoom): GameRoom {
  if (room.currentPhase !== "LOBBY") throw new Error("仅能在大厅添加测试玩家。");
  const emptySeat = room.players.find((p) => !p.name);
  if (!emptySeat) throw new Error("座位已满（9 人），无法再添加。");
  const usedRoles = new Set(
    room.players.map((p) => p.preferredRoleId).filter((r): r is string => !!r)
  );
  const available = shuffle(ROLE_IDS.filter((r) => !usedRoles.has(r)));
  if (available.length === 0) throw new Error("没有可用的唯一角色了。");
  const roleId = available[0];
  const genes = randomGenes();
  const updated: Player = {
    ...emptySeat,
    name: `测试${emptySeat.seatIndex + 1}`,
    preferredRoleId: roleId,
    force: genes.force,
    speed: genes.speed,
    load: genes.load,
    location: shuffle(SPAWN_ROOMS)[0],
    isReady: true,
  };
  let next = replacePlayer(room, updated);
  next = appendLog(next, `[本地测试] 随机生成 1 名测试玩家（${getRole(roleId)?.name ?? roleId}）。`);
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
