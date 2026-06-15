// 结算编排：按固定顺序生成 ResolutionPreview（不直接修改真实状态）。
// 来源：规则手册 8.1 固定结算顺序；开发指令 3.5。
// 步骤顺序：房间效果 → 战斗 → 暗影 → 火箭筒 → 毒气 → 水粮 → 道具回血/状态 → 死亡/复活检查。

import type {
  GameRoom,
  Player,
  ResolutionEffect,
  ResolutionPreview,
  ResolutionStep,
} from "../types";
import { roundGasDamage, FOOD_WATER_START_ROUND } from "../config/rounds";
import { getRoomLabel } from "../config/rooms";
import { getFloorLabel } from "../config/floors";
import { getItemName, weaponBonusOf, isWeaponItem } from "../config/items";
import { invAdd } from "../inventory";
import { isRoomGassed } from "../gas";
import { computeCombatDamage, type Combatant } from "./combat";
import { tallyGasVotes } from "./gasVote";
import { waterFoodDamage } from "./waterFood";

function clone(room: GameRoom): GameRoom {
  return JSON.parse(JSON.stringify(room)) as GameRoom;
}

/** 玩家本轮结算所在房间（移动终点） */
function roomOf(p: Player): string {
  return p.submittedAction?.toRoom ?? p.location ?? "";
}

function aliveIn(players: Player[], roomId: string): Player[] {
  return players.filter((p) => p.status === "alive" && roomOf(p) === roomId);
}
function shadowsIn(players: Player[], roomId: string): Player[] {
  return players.filter((p) => p.status === "shadow" && roomOf(p) === roomId);
}

/** 受伤：肾上腺素生效轮中生命最低保留 1；否则最低 0。返回实际扣血（正数）。 */
function applyDamage(p: Player, amount: number, round: number): number {
  if (amount <= 0) return 0;
  const protectedFloor = p.adrenalineActiveRound === round ? 1 : 0;
  const newHp = Math.max(protectedFloor, p.hp - amount);
  const dealt = p.hp - newHp;
  p.hp = newHp;
  return dealt;
}

function heal(p: Player, amount: number): number {
  const newHp = Math.min(p.maxHp, p.hp + amount);
  const gain = newHp - p.hp;
  p.hp = newHp;
  return gain;
}

function removeOne(p: Player, id: string): boolean {
  const idx = p.inventory.indexOf(id);
  if (idx === -1) return false;
  p.inventory.splice(idx, 1);
  return true;
}

function consume(draft: GameRoom, id: string, n = 1) {
  draft.consumedPile = invAdd(draft.consumedPile, id, n);
}

/** 战斗力 = 武力 + 所有持有武器加成 */
function combatPower(p: Player): number {
  let bonus = 0;
  for (const id of p.inventory) bonus += weaponBonusOf(id);
  return p.force + bonus;
}
function hasGun(p: Player): boolean {
  return p.inventory.some((id) => id === "pistol" || id === "shotgun");
}

// —— 各步骤 ——

function stepRoomEffects(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];
  const alive = draft.players.filter((p) => p.status === "alive");

  // 注：102 激光室伤害已在玩家提交移动时即时结算（v0.3 movement），此处不再重复处理。
  for (const p of alive) {
    const room = roomOf(p);
    // 基因库 201：选择使用则三项 +1（规则 14.1，轻量版）
    if (room === "201" && p.submittedAction?.roomAction === "gene") {
      p.force += 1;
      p.speed += 1;
      p.load += 1;
      effects.push({ playerId: p.id, roomId: room, reason: "基因库：武力/速度/负重各 +1" });
      logs.push(`${p.name} 在基因库(201) 三项属性各 +1。`);
    }
  }

  // 手术室 B202：恰好 2 人，每人 +4 且不战斗（规则 14.1）
  const surgery = aliveIn(draft.players, "B202");
  if (surgery.length === 2) {
    for (const p of surgery) {
      const g = heal(p, 4);
      effects.push({ playerId: p.id, roomId: "B202", hpChange: g, reason: "手术室 +4" });
      logs.push(`${p.name} 在手术室(B202) 接受手术，生命 +${g}。`);
    }
  }

  if (logs.length === 0) logs.push("本轮无特殊房间效果。");
  return { type: "roomEffects", title: "1. 房间效果", logs, effects };
}

function stepCombat(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];

  const rooms = new Set(draft.players.filter((p) => p.status === "alive").map(roomOf));
  for (const roomId of rooms) {
    const fighters = aliveIn(draft.players, roomId);
    if (fighters.length < 2) continue;
    // 手术室恰好 2 人不战斗（已在房间效果 +4）
    if (roomId === "B202" && fighters.length === 2) continue;

    const combatants: Combatant[] = fighters.map((p) => ({
      id: p.id,
      power: combatPower(p),
      hasGun: hasGun(p),
    }));
    const outcome = computeCombatDamage(combatants);
    const kind = fighters.length >= 3 ? "乱斗" : "战斗";
    const detail = fighters
      .map((p) => `${p.name}(战力${combatPower(p)}${hasGun(p) ? "·枪" : ""})`)
      .join(" vs ");
    logs.push(
      `${getRoomLabel(roomId)} 发生${kind}${outcome.gunSuppression ? "（枪械压制）" : ""}：${detail}`
    );
    for (const p of fighters) {
      const dmg = outcome.damage[p.id] ?? 0;
      if (dmg > 0) {
        const dealt = applyDamage(p, dmg, round);
        effects.push({ playerId: p.id, roomId, hpChange: -dealt, reason: `${kind}失败` });
        logs.push(`  ${p.name} 扣 ${dealt} 点生命。`);
      }
    }
  }

  if (logs.length === 0) logs.push("本轮无战斗或乱斗。");
  return { type: "combat", title: "2. 战斗 / 乱斗", logs, effects };
}

function stepShadow(draft: GameRoom): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];

  const rooms = new Set(draft.players.filter((p) => p.status === "shadow").map(roomOf));
  for (const roomId of rooms) {
    const shadows = shadowsIn(draft.players, roomId);
    const alive = aliveIn(draft.players, roomId);
    if (shadows.length === 0 || alive.length === 0) continue;

    // 每名存活玩家受到的吸血 = 同房间暗影数量（暗影吸血不受激光室影响、不经死亡保护）
    for (const p of alive) {
      const before = p.hp;
      p.hp = Math.max(0, p.hp - shadows.length); // 吸血不享受肾上腺素保护？规则未豁免，按普通伤害但保留肾上腺素：使用统一最低 0
      const dealt = before - p.hp;
      if (dealt > 0) {
        effects.push({ playerId: p.id, roomId, hpChange: -dealt, reason: `暗影吸血 x${shadows.length}` });
      }
    }
    for (const s of shadows) {
      s.shadowDrainCount += alive.length;
      s.lastDrainRoomId = roomId;
      effects.push({ playerId: s.id, roomId, reason: `吸血 +${alive.length}（累计 ${s.shadowDrainCount}）` });
    }
    logs.push(
      `${getRoomLabel(roomId)}：${shadows.length} 暗影吸取 ${alive.length} 名存活玩家，每人 -${shadows.length}。`
    );
  }

  if (logs.length === 0) logs.push("本轮无暗影吸血。");
  return { type: "shadow", title: "3. 暗影吸血", logs, effects };
}

function stepRocket(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];

  const shooters = draft.players.filter(
    (p) => p.status === "alive" && p.inventory.includes("rocket") && p.submittedAction?.rocketTargetRoom
  );
  for (const shooter of shooters) {
    const target = shooter.submittedAction!.rocketTargetRoom!;
    const victims = aliveIn(draft.players, target);
    logs.push(`${shooter.name} 用火箭筒袭击 ${getRoomLabel(target)}。`);
    for (const v of victims) {
      const dealt = applyDamage(v, 4, round);
      if (dealt > 0) {
        effects.push({ playerId: v.id, roomId: target, hpChange: -dealt, reason: "火箭筒 -4" });
        logs.push(`  ${v.name} 扣 ${dealt} 点生命。`);
      }
    }
  }

  if (logs.length === 0) logs.push("本轮无火箭筒袭击。");
  return { type: "rocket", title: "4. 火箭筒", logs, effects };
}

function stepGas(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];

  // 统计投票产生新毒气楼层
  const { newFloors, tally } = tallyGasVotes(draft.players, draft.gasFloors);
  if (newFloors.length > 0) {
    draft.gasFloors = [...draft.gasFloors, ...newFloors];
    logs.push(
      newFloors.length === 1
        ? `毒气投票：${getFloorLabel(newFloors[0])} 成为毒气楼层。`
        : `毒气投票：${newFloors.map(getFloorLabel).join("、")} 并列最高，均成为毒气楼层。`
    );
  } else {
    logs.push("毒气投票：无有效票，未产生新毒气楼层。");
  }
  const tallyText = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${getFloorLabel(f)}:${n}`)
    .join("，");
  if (tallyText) logs.push(`计票：${tallyText}`);

  // 毒气伤害
  const dmg = roundGasDamage[round] ?? 0;
  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    const room = roomOf(p);
    if (!isRoomGassed(room, draft.gasFloors, draft.clearedGasRooms)) continue;
    // 免疫：防毒面具 / 停机坪 / 复活当轮
    if (p.inventory.includes("gasmask")) continue;
    if (room === "202") continue;
    if (p.reviveProtectedRound === round) continue;

    const dealt = applyDamage(p, dmg, round);
    if (dealt > 0) {
      effects.push({ playerId: p.id, roomId: room, hpChange: -dealt, reason: `毒气 -${dmg}` });
      logs.push(`${p.name} 在 ${getRoomLabel(room)} 受毒气伤害 -${dealt}。`);
    }
  }

  return { type: "gas", title: "5. 毒气", logs, effects };
}

function stepWaterFood(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];

  if (round < FOOD_WATER_START_ROUND) {
    logs.push(`第 ${round} 轮无需上交水粮（从第 ${FOOD_WATER_START_ROUND} 轮开始）。`);
    return { type: "foodWater", title: "6. 水粮", logs, effects };
  }

  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    const room = roomOf(p);
    // 免除：餐厅 / 复活当轮
    if (room === "B204") {
      logs.push(`${p.name} 在餐厅(B204) 免上交水粮。`);
      continue;
    }
    if (p.reviveProtectedRound === round) {
      logs.push(`${p.name} 复活当轮免上交水粮。`);
      continue;
    }

    const wantW = !!p.submittedAction?.submitWater;
    const wantF = !!p.submittedAction?.submitFood;
    const okW = wantW && removeOne(p, "water");
    const okF = wantF && removeOne(p, "food");
    if (okW) consume(draft, "water");
    if (okF) consume(draft, "food");
    if (wantW && !okW) logs.push(`${p.name} 计划上交水但库存不足。`);
    if (wantF && !okF) logs.push(`${p.name} 计划上交粮食但库存不足。`);

    const d = waterFoodDamage(okW, okF);
    if (d > 0) {
      const dealt = applyDamage(p, d, round);
      effects.push({ playerId: p.id, roomId: room, hpChange: -dealt, reason: `水粮不足 -${d}` });
      logs.push(`${p.name} 水粮不足，扣 ${dealt} 点生命。`);
    } else {
      logs.push(`${p.name} 上交水+粮，不扣血。`);
    }
  }
  return { type: "foodWater", title: "6. 水粮", logs, effects };
}

function stepItems(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];

  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    const uses = p.submittedAction?.useItems ?? [];
    for (const id of uses) {
      if (!p.inventory.includes(id)) continue;
      if (id === "pill") {
        removeOne(p, "pill");
        consume(draft, "pill");
        const g = heal(p, 2);
        effects.push({ playerId: p.id, itemId: id, hpChange: g, reason: "药片 +2" });
        logs.push(`${p.name} 使用药片，生命 +${g}。`);
      } else if (id === "adrenaline") {
        removeOne(p, "adrenaline");
        consume(draft, "adrenaline");
        p.pendingAdrenalineRound = round + 1;
        effects.push({ playerId: p.id, itemId: id, reason: "肾上腺素：下一轮生效" });
        logs.push(`${p.name} 使用肾上腺素，将于第 ${round + 1} 轮生效（速度 10、伤害最低降至 1）。`);
      } else if (id === "wine") {
        removeOne(p, "wine");
        consume(draft, "wine");
        const dice = 1 + Math.floor(Math.random() * 6);
        const r = applyWine(draft, p, dice);
        effects.push({ playerId: p.id, itemId: id, hpChange: r.hpChange, reason: `酒掷骰 ${dice}：${r.text}` });
        logs.push(`${p.name} 使用酒，掷出 ${dice}：${r.text}。`);
      }
      // 其他道具（武器/装备/火箭筒/防毒面具/次元口袋）为持有生效，不在此处理
    }
  }

  if (logs.length === 0) logs.push("本轮无道具回血/状态结算。");
  return { type: "itemStatus", title: "7. 道具回血 / 状态", logs, effects };
}

/** 酒掷骰效果（规则 15.2） */
function applyWine(draft: GameRoom, p: Player, dice: number): { text: string; hpChange?: number } {
  switch (dice) {
    case 1: {
      // 丢弃所有道具卡 → 留在当前房间
      const room = roomOf(p);
      let inv = draft.roomInventories[room] ?? {};
      for (const id of p.inventory) inv = invAdd(inv, id, 1);
      draft.roomInventories[room] = inv;
      const count = p.inventory.length;
      p.inventory = [];
      return { text: `丢弃全部 ${count} 张道具` };
    }
    case 2:
      return { text: "无事发生" };
    case 3:
      p.force += 1;
      return { text: "武力永久 +1" };
    case 4:
      p.speed += 1;
      return { text: "速度永久 +1" };
    case 5:
      p.load += 1;
      return { text: "负重永久 +1" };
    case 6: {
      const g = heal(p, 2);
      return { text: `生命 +${g}`, hpChange: g };
    }
    default:
      return { text: "无事发生" };
  }
}

function stepDeathRevive(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];

  // 死亡检查：存活且生命 0 → 暗影
  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    if (p.hp > 0) continue;
    const room = roomOf(p);
    // 遗物进入停尸间
    let tomb = draft.roomInventories["B701"] ?? {};
    for (const id of p.inventory) tomb = invAdd(tomb, id, 1);
    draft.roomInventories["B701"] = tomb;

    p.inventory = [];
    p.status = "shadow";
    p.previousLocation = room;
    p.location = "B701"; // 下一轮从停尸间出发
    p.submittedAction = null;
    p.shadowDrainCount = 0;
    p.reviveNextRound = false;
    effects.push({ playerId: p.id, statusChange: "shadow", reason: "生命归 0，变成暗影" });
    logs.push(`${p.name} 生命归 0，变成暗影，遗物进入停尸间(B701)，下一轮从 B701 出发。`);
  }

  // 复活检查：暗影累计吸血 >= 2 → 下一轮复活
  for (const p of draft.players) {
    if (p.status !== "shadow") continue;
    if (p.shadowDrainCount >= 2 && p.lastDrainRoomId) {
      p.reviveNextRound = true;
      p.reviveProtectedRound = round + 1;
      effects.push({ playerId: p.id, reason: `满足复活：下一轮在 ${getRoomLabel(p.lastDrainRoomId)} 复活，生命 ${p.shadowDrainCount}` });
      logs.push(
        `${p.name} 累计吸血 ${p.shadowDrainCount}，将于第 ${round + 1} 轮在 ${getRoomLabel(p.lastDrainRoomId)} 复活（生命 ${p.shadowDrainCount}）。`
      );
    }
  }

  if (logs.length === 0) logs.push("本轮无玩家死亡或复活。");
  return { type: "deathRevive", title: "8. 死亡 / 复活检查", logs, effects };
}

/**
 * 生成本轮结算预览。draft 为深拷贝，按固定顺序应用各步骤；
 * 返回的 nextRoom 即确认后应用的状态（含随机结果）。
 */
export function buildResolutionPreview(room: GameRoom): ResolutionPreview {
  const draft = clone(room);
  const round = draft.currentRound;

  const steps: ResolutionStep[] = [
    stepRoomEffects(draft, round),
    stepCombat(draft, round),
    stepShadow(draft),
    stepRocket(draft, round),
    stepGas(draft, round),
    stepWaterFood(draft, round),
    stepItems(draft, round),
    stepDeathRevive(draft, round),
  ];

  draft.resolutionPreview = null; // 避免嵌套
  return {
    round,
    steps,
    nextRoom: draft,
    generatedAt: new Date().toISOString(),
  };
}
