// 职业技能引擎（来源：规则手册 3.2）。
// 这里集中职业的「开局设置」「战斗/投票修正」等纯逻辑；结算过程中的被动钩子
// （暗影使者、病毒携带者、入殓师、预言家、慈善家、化学家、催眠师）在 resolution/resolveRound.ts
// 的对应步骤中调用本文件导出的辅助函数，保证规则不散落在 UI。

import type { GameRoom, Inventory, Player } from "../types";
import { invRemove, invToList, isOverweight } from "../inventory";
import { roleMaxUses } from "../config/roles";
import { isGunItem, getItemName } from "../config/items";
import { getRoomLabel, ROOM_IDS } from "../config/rooms";
import { normalStepDistance } from "../utils/movement";

const HOUND_MAX_STEPS = 5;
const HELIPAD = "202";

/** 富豪开局金条：金库 B206 +2、大仓库 B501 +1（对应房间库存减少）。 */
function grantTycoonGold(room: GameRoom, p: Player): string[] {
  const logs: string[] = [];
  const take = (roomId: string, n: number) => {
    const { inv, removed } = invRemove(room.roomInventories[roomId] ?? {}, "gold", n);
    room.roomInventories[roomId] = inv;
    for (let i = 0; i < removed; i++) p.inventory.push("gold");
    return removed;
  };
  const a = take("B206", 2);
  const b = take("B501", 1);
  if (a + b > 0) logs.push(`富豪 ${p.name} 开局获得 ${a + b} 张金条（金库 ${a}、大仓库 ${b}）。`);
  return logs;
}

/**
 * 开局应用职业设置：初始化运行时字段、富豪金条、驯兽师永久 +1。
 * 在 startGame 完成基础初始化后调用。
 */
export function applyRoleSetup(room: GameRoom): { room: GameRoom; logs: string[] } {
  const logs: string[] = [];
  for (const p of room.players) {
    if (!p.name || !p.roleId) continue;
    // 运行时字段初始化
    p.roleUses = 0;
    p.infection = 0;
    p.charmedDone = false;
    p.trackedDone = false;
    p.giftedDone = false;
    p.forcedRoom = null;
    p.roleHealPending = 0;
    p.pendingGenePoints = 0;
    p.forecastedBy = [];
    p.roleActionsUsed = [];

    if (p.roleId === "tycoon") {
      logs.push(...grantTycoonGold(room, p));
    } else if (p.roleId === "beastmaster") {
      p.force += 1;
      p.load += 1;
      logs.push(`驯兽师 ${p.name} 武力、负重各永久 +1。`);
    } else if (p.roleId === "bartender") {
      // 果汁管=酒窖 B601：开局获得 B601 的 2 张果汁
      const { inv, removed } = invRemove(room.roomInventories["B601"] ?? {}, "juice", 2);
      room.roomInventories["B601"] = inv;
      for (let i = 0; i < removed; i++) p.inventory.push("juice");
      if (removed > 0) logs.push(`饮品师 ${p.name} 开局从酒窖(B601) 获得 ${removed} 张果汁。`);
    }
  }
  return { room, logs };
}

/**
 * 战斗中是否视为持枪。雇佣兵的刀与手枪同效，故雇佣兵持刀也视为持枪（规则 3.2）。
 */
export function roleHasGun(p: Player): boolean {
  if (p.inventory.some(isGunItem)) return true;
  if (p.roleId === "mercenary" && p.inventory.includes("knife")) return true;
  return false;
}

/**
 * 毒气投票权重。意见领袖 / 预言家拥有额外 N×2 票（N=其他在座玩家数）。
 * 控制室「1 票视为 10 票」与额外票权不叠加，取较大值（边角情形，见 roles.ts 说明）。
 */
export function gasVoteWeight(p: Player, otherSeatedCount: number): number {
  let base = 1;
  if (p.roleId === "influencer" || p.roleId === "prophet") {
    base = 1 + otherSeatedCount * 2;
  }
  const controlVote10 = p.submittedAction?.roomAction === "control_vote10";
  return controlVote10 ? Math.max(10, base) : base;
}

/** 校验并登记一次限次技能使用；超限抛错。 */
function consumeRoleUse(p: Player, max: number): void {
  const used = p.roleUses ?? 0;
  if (used >= max) throw new Error("该技能本局使用次数已用尽。");
  p.roleUses = used + 1;
}

const CHARM_MAX_STEPS = 5;

/** 黑客行动整局限次校验与登记。 */
function consumeHackerAction(p: Player, kind: string): void {
  const used = p.roleActionsUsed ?? [];
  if (used.includes(kind)) throw new Error("黑客该行动本局已使用过。");
  p.roleActionsUsed = [...used, kind];
}

/**
 * 处理玩家提交时声明的主动技能（催眠 / 死亡预告 / 黑客关闭房间或远程功能）。
 * 会改动房间与目标玩家状态，返回新的房间对象（克隆）。校验失败抛错由提交方处理。
 * chemist / gift / juice / track 在别处生效，这里不处理（track 在 submitAction 处理移动）。
 */
export function applyDeclaredSkill(room: GameRoom, actorId: string): { room: GameRoom; logs: string[] } {
  const actor = room.players.find((p) => p.id === actorId);
  const skill = actor?.submittedAction?.roleSkill;
  if (!actor || !skill) return { room, logs: [] };

  // 克隆所有玩家，避免改动 store 中共享对象
  const players: Player[] = room.players.map((p) => ({
    ...p,
    forecastedBy: [...(p.forecastedBy ?? [])],
    roleActionsUsed: [...(p.roleActionsUsed ?? [])],
  }));
  const me = players.find((p) => p.id === actorId)!;
  const logs: string[] = [];
  let clearedGasRooms = room.clearedGasRooms;
  let closedRooms = room.closedRooms;
  let roomInventories = room.roomInventories;
  let airdrops = room.airdrops;

  if (skill.type === "charm") {
    if (actor.roleId !== "hypnotist") throw new Error("非催眠师不能催眠。");
    const targetId = skill.targetPlayerIds?.[0];
    const room2 = skill.targetRoom;
    const target = players.find((p) => p.id === targetId);
    if (!target) throw new Error("催眠目标不存在。");
    if (target.status !== "alive") throw new Error("只能催眠存活玩家。");
    if (target.charmedDone) throw new Error("该玩家本局已被催眠过。");
    if (!room2 || !ROOM_IDS.includes(room2)) throw new Error("催眠目标房间非法。");
    const dist = normalStepDistance(target.location ?? "", room2);
    if (dist === null || dist > CHARM_MAX_STEPS) {
      throw new Error(`目标 ${CHARM_MAX_STEPS} 步内无法到达该房间，催眠将失败，请改选。`);
    }
    consumeRoleUse(me, roleMaxUses("hypnotist"));
    target.forcedRoom = room2;
    target.charmedDone = true;
    me.roleHealPending = (me.roleHealPending ?? 0) + 1;
    logs.push(`催眠师 ${me.name} 催眠了 ${target.name}，强制其本轮前往 ${getRoomLabel(room2)}。`);
  } else if (skill.type === "forecast") {
    if (actor.roleId !== "prophet") throw new Error("非预言家不能做死亡预告。");
    const targets = (skill.targetPlayerIds ?? [])
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is Player => !!p && p.id !== actorId && p.status === "alive");
    if (targets.length === 0) throw new Error("请选择至少 1 名存活玩家做死亡预告。");
    consumeRoleUse(me, roleMaxUses("prophet"));
    for (const t of targets) {
      if (!t.forecastedBy!.includes(actorId)) t.forecastedBy!.push(actorId);
    }
    logs.push(`预言家 ${me.name} 对 ${targets.length} 名玩家做出死亡预告。`);
  } else if (skill.type === "hacker_close") {
    if (actor.roleId !== "hacker") throw new Error("非黑客不能关闭房间功能。");
    const r2 = skill.targetRoom;
    if (!r2 || !ROOM_IDS.includes(r2)) throw new Error("关闭目标房间非法。");
    consumeHackerAction(me, "close");
    if (!closedRooms.includes(r2)) closedRooms = [...closedRooms, r2];
    logs.push(`黑客 ${me.name} 秘密关闭了 ${getRoomLabel(r2)} 的功能（本轮进入者无法触发效果/抽卡）。`);
  } else if (skill.type === "hacker_func") {
    if (actor.roleId !== "hacker") throw new Error("非黑客不能远程执行房间功能。");
    const choice = skill.funcChoice;
    if (choice === "gene") {
      consumeHackerAction(me, "gene");
      me.force += 1; me.speed += 1; me.load += 1;
      logs.push(`黑客 ${me.name} 远程执行基因库：武力/速度/负重各 +1。`);
    } else if (choice === "control") {
      consumeHackerAction(me, "control");
      if (skill.targetRoom) {
        if (!ROOM_IDS.includes(skill.targetRoom)) throw new Error("解毒目标房间非法。");
        if (!clearedGasRooms.includes(skill.targetRoom)) clearedGasRooms = [...clearedGasRooms, skill.targetRoom];
        logs.push(`黑客 ${me.name} 远程执行控制室：解除 ${getRoomLabel(skill.targetRoom)} 的毒气。`);
      } else {
        // 1 票视为 10 票：写入本人提交的 roomAction，毒气统计据此计权
        if (me.submittedAction) me.submittedAction = { ...me.submittedAction, roomAction: "control_vote10" };
        logs.push(`黑客 ${me.name} 远程执行控制室：本轮毒气投票 1 票视为 10 票。`);
      }
    } else if (choice === "operate") {
      consumeHackerAction(me, "operate");
      const g = skill.genes;
      if (!g) throw new Error("操作室需要提供新的基因分配。");
      const sum = g.force + g.speed + g.load;
      if (sum !== me.force + me.speed + me.load) throw new Error("重新分配的基因总和必须与当前一致。");
      if (g.force < 0 || g.speed < 0 || g.load < 0) throw new Error("基因不能为负。");
      me.force = g.force; me.speed = g.speed; me.load = g.load;
      logs.push(`黑客 ${me.name} 远程执行操作室：重新分配基因为 武力${g.force}/速度${g.speed}/负重${g.load}。`);
    } else {
      throw new Error("未知的黑客功能。");
    }
  } else if (skill.type === "hound") {
    if (actor.roleId !== "beastmaster") throw new Error("非驯兽师不能派遣猎犬。");
    consumeRoleUse(me, roleMaxUses("beastmaster")); // 整局限 4 次
    const targetRoom = skill.targetRoom;
    if (!targetRoom || !ROOM_IDS.includes(targetRoom)) throw new Error("猎犬目标房间非法。");
    if (targetRoom === me.location) throw new Error("猎犬需前往其他房间。");
    const dist = normalStepDistance(me.location ?? "", targetRoom);
    if (dist === null || dist > HOUND_MAX_STEPS) {
      throw new Error(`猎犬只能前往 ${HOUND_MAX_STEPS} 步内（不经捷径）有库存的房间。`);
    }

    // 抽取池：停机坪取未领取空投，其余房间取房间库存
    const result = houndPick(targetRoom, roomInventories, airdrops);
    if (!result) {
      logs.push(`驯兽师 ${me.name} 派遣猎犬前往 ${getRoomLabel(targetRoom)}，但无库存可抽，无功而返。`);
    } else {
      const tmp: Player = { ...me, inventory: [...me.inventory, result.itemId] };
      if (isOverweight(tmp)) {
        logs.push(`驯兽师 ${me.name} 的猎犬在 ${getRoomLabel(targetRoom)} 抽到${getItemName(result.itemId)}，但会超重，无法携带，无功而返。`);
      } else {
        me.inventory = tmp.inventory;
        roomInventories = result.roomInventories;
        airdrops = result.airdrops;
        logs.push(`驯兽师 ${me.name} 的猎犬从 ${getRoomLabel(targetRoom)} 带回 1 张${getItemName(result.itemId)}。`);
      }
    }
  }

  return { room: { ...room, players, clearedGasRooms, closedRooms, roomInventories, airdrops }, logs };
}

/** 猎犬随机抽取 1 张：返回抽中道具与更新后的库存/空投；无库存返回 null。 */
function houndPick(
  targetRoom: string,
  roomInventories: GameRoom["roomInventories"],
  airdrops: GameRoom["airdrops"]
): { itemId: string; roomInventories: GameRoom["roomInventories"]; airdrops: GameRoom["airdrops"] } | null {
  if (targetRoom === HELIPAD) {
    // 停机坪：从未领取空投中随机抽 1 张
    const entries: Array<{ idx: number; itemId: string }> = [];
    airdrops.forEach((a, idx) => {
      if (a.claimed) return;
      for (const id of invToList(a.items)) entries.push({ idx, itemId: id });
    });
    if (entries.length === 0) return null;
    const pick = entries[Math.floor(Math.random() * entries.length)];
    const nextAirdrops = airdrops.map((a, idx) => {
      if (idx !== pick.idx) return a;
      const items: Inventory = { ...a.items };
      items[pick.itemId] -= 1;
      if (items[pick.itemId] <= 0) delete items[pick.itemId];
      return { ...a, items, claimed: Object.keys(items).length === 0 ? true : a.claimed };
    });
    return { itemId: pick.itemId, roomInventories, airdrops: nextAirdrops };
  }
  const pool = invToList(roomInventories[targetRoom] ?? {});
  if (pool.length === 0) return null;
  const itemId = pool[Math.floor(Math.random() * pool.length)];
  const { inv } = invRemove(roomInventories[targetRoom] ?? {}, itemId, 1);
  return { itemId, roomInventories: { ...roomInventories, [targetRoom]: inv }, airdrops };
}
