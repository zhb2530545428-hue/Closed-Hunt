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
import { roundGasDamage, FOOD_WATER_START_ROUND, formatRoundLabel } from "../config/rounds";
import { getRoomLabel } from "../config/rooms";
import { getFloorLabel } from "../config/floors";
import { getItemName, weaponBonusOf, isWeaponItem, normalizeItemId } from "../config/items";
import { isRoomFunctionDisabledForAction, isRoomFunctionDisabledForResolution, isResolutionRoomFunction } from "../config/roomFunctions";
import { invAdd, canGainItem } from "../inventory";
import { isRoomGassed } from "../gas";
import { computeCombatDamage, type Combatant } from "./combat";
import { tallyGasVotes } from "./gasVote";
import { waterFoodDamage } from "./waterFood";
import { roleHasGun } from "../engine/roleEffects";
import { pathTriggersLaser } from "../utils/movement";
import { roleName } from "../utils/names";

function clone(room: GameRoom): GameRoom {
  return JSON.parse(JSON.stringify(room)) as GameRoom;
}

/** 结算日志统一以角色名称展示玩家（v1.0.2 §6；角色开局已公开）。 */
function nm(p: Player): string {
  return roleName(p);
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
  return roleHasGun(p);
}

// —— 各步骤 ——

function stepRoomEffects(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  // §4.3：房间效果会暴露玩家位置——公开日志不写具体玩家/房间，仅写裁判明细(hostLogs)与本人私密(privateLogs)。
  const logs: string[] = [];
  const hostLogs: string[] = [];
  const privateLogs: Array<{ playerId: string; text: string }> = [];
  const alive = draft.players.filter((p) => p.status === "alive");

  // 102 激光室（规则 7.3 经过型效果）：存活玩家本轮路径经过/停留 102 → -1 生命（暗影不受影响）。
  // v1.0.1（§8）：行动阶段不再即时扣血，统一在结算「房间效果」步骤处理。
  // 经过型效果不受黑客关闭房间影响。位置敏感——不进公开日志。
  for (const p of alive) {
    if (!pathTriggersLaser(p.submittedAction?.path, p.status)) continue;
    const dealt = applyDamage(p, 1, round);
    if (dealt > 0) {
      effects.push({ playerId: p.id, roomId: "102", hpChange: -dealt, reason: "激光室 -1" });
      hostLogs.push(`${nm(p)} 经过/停留 102 激光室，扣 ${dealt} 点生命。`);
      privateLogs.push({ playerId: p.id, text: `你经过/停留 102 激光室，扣 ${dealt} 点生命。` });
    }
  }

  for (const p of alive) {
    const room = roomOf(p);
    // 黑客关闭：行动即时效果按关闭顺位判断；结算效果按本轮是否关闭判断。
    const disabled = isResolutionRoomFunction(room)
      ? isRoomFunctionDisabledForResolution(room, draft)
      : isRoomFunctionDisabledForAction(room, draft, p);
    if (disabled) {
      privateLogs.push({
        playerId: p.id,
        text: `你本轮所在的 ${getRoomLabel(room)} 功能被关闭，无法触发房间效果或抽取道具。`,
      });
      continue;
    }
    // 基因库 201：选择使用则三项 +1（规则 14.1，轻量版）
    if (room === "201" && p.submittedAction?.roomAction === "gene") {
      p.force += 1;
      p.speed += 1;
      p.load += 1;
      effects.push({ playerId: p.id, roomId: room, reason: "基因库：武力/速度/负重各 +1" });
      hostLogs.push(`${nm(p)} 在基因库(201) 三项属性各 +1。`);
      privateLogs.push({ playerId: p.id, text: "你在基因库(201) 三项属性各 +1。" });
    }
  }

  // 手术室 B202：恰好 2 人，每人 +4 且不战斗（规则 14.1）；被黑客关闭则失效。
  const surgery = isRoomFunctionDisabledForResolution("B202", draft) ? [] : aliveIn(draft.players, "B202");
  if (surgery.length === 2) {
    for (const p of surgery) {
      const g = heal(p, 4);
      effects.push({ playerId: p.id, roomId: "B202", hpChange: g, reason: "手术室 +4" });
      hostLogs.push(`${nm(p)} 在手术室(B202) 接受手术，生命 +${g}。`);
      privateLogs.push({ playerId: p.id, text: `你在手术室(B202) 接受手术，生命 +${g}。` });
    }
  }

  logs.push("房间效果已结算（详情见各玩家私密记录）。");
  return { type: "roomEffects", title: "1. 房间效果", logs, hostLogs, privateLogs, effects };
}

function stepCombat(draft: GameRoom, round: number, includeCarrier = true): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  // §4.2：公开只显示「哪个房间发生战斗 / 乱斗」，不显示参战者、谁打谁、谁扣几点血。
  const logs: string[] = [];
  const hostLogs: string[] = [];
  const privateLogs: Array<{ playerId: string; text: string }> = [];

  const rooms = new Set(draft.players.filter((p) => p.status === "alive").map(roomOf));
  for (const roomId of rooms) {
    const fighters = aliveIn(draft.players, roomId);
    if (fighters.length < 2) continue;
    // 手术室恰好 2 人不战斗（已在房间效果 +4）；被黑客关闭则照常战斗
    if (roomId === "B202" && fighters.length === 2 && !isRoomFunctionDisabledForResolution("B202", draft)) continue;

    const combatants: Combatant[] = fighters.map((p) => ({
      id: p.id,
      power: combatPower(p),
      hasGun: hasGun(p),
    }));
    const outcome = computeCombatDamage(combatants);
    const kind = fighters.length >= 3 ? "乱斗" : "战斗";
    // 公开：仅房间 + 战斗/乱斗。
    logs.push(`${getRoomLabel(roomId)} 发生${kind}。`);
    // 裁判明细：参战者、战力、枪械压制、逐人伤害。
    const detail = fighters
      .map((p) => `${nm(p)}(战力${combatPower(p)}${hasGun(p) ? "·枪" : ""})`)
      .join(" vs ");
    hostLogs.push(`${getRoomLabel(roomId)} ${kind}${outcome.gunSuppression ? "（枪械压制）" : ""}：${detail}`);
    for (const p of fighters) {
      const dmg = outcome.damage[p.id] ?? 0;
      if (dmg > 0) {
        const dealt = applyDamage(p, dmg, round);
        effects.push({ playerId: p.id, roomId, hpChange: -dealt, reason: `${kind}失败` });
        hostLogs.push(`  ${nm(p)} 扣 ${dealt} 点生命。`);
        privateLogs.push({ playerId: p.id, text: `你在 ${getRoomLabel(roomId)} 的${kind}中扣 ${dealt} 点生命。` });
      }
    }
  }

  // 病毒携带者：与战斗同时结算。同房间其他存活玩家额外扣 N（其他存活数）并叠加感染标记；
  // 初始轮（第 1 轮）仅叠加标记，无伤害。规则 3.2。位置/伤害敏感——仅裁判与本人可见。
  if (includeCarrier) {
    const carriers = draft.players.filter((p) => p.status === "alive" && p.roleId === "carrier");
    for (const carrier of carriers) {
      const room = roomOf(carrier);
      const others = aliveIn(draft.players, room).filter((p) => p.id !== carrier.id);
      if (others.length === 0) continue;
      const n = others.length;
      hostLogs.push(`病毒携带者 ${nm(carrier)} 在 ${getRoomLabel(room)} 对 ${n} 名存活玩家施加感染${round <= 1 ? "（初始轮仅标记）" : `（各 -${n}）`}。`);
      for (const v of others) {
        v.infection = (v.infection ?? 0) + 1;
        if (round > 1) {
          const dealt = applyDamage(v, n, round);
          effects.push({ playerId: v.id, roomId: room, hpChange: -dealt, reason: `病毒感染 -${n}` });
          hostLogs.push(`  ${nm(v)} 受感染扣 ${dealt} 点生命（感染层数 ${v.infection}）。`);
          privateLogs.push({ playerId: v.id, text: `你被病毒感染扣 ${dealt} 点生命（感染层数 ${v.infection}）。` });
        } else {
          hostLogs.push(`  ${nm(v)} 叠加感染标记（层数 ${v.infection}）。`);
          privateLogs.push({ playerId: v.id, text: `你被叠加 1 层感染标记（层数 ${v.infection}）。` });
        }
      }
    }
  }

  if (logs.length === 0) logs.push("本轮无战斗或乱斗。");
  return { type: "combat", title: "2. 战斗 / 乱斗", logs, hostLogs, privateLogs, effects };
}

function stepShadow(draft: GameRoom): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  // §8.3 允许公开「哪些房间发生暗影吸血」，但不公开被吸者身份与扣血量。
  const logs: string[] = [];
  const hostLogs: string[] = [];
  const privateLogs: Array<{ playerId: string; text: string }> = [];

  // 暗影使者免疫被吸血（不计入被吸对象，暗影也不因其增加吸血量）。规则 3.2。
  let envoyHeals = 0; // 本步骤内暗影实际吸到的生命点数。

  const rooms = new Set(draft.players.filter((p) => p.status === "shadow").map(roomOf));
  for (const roomId of rooms) {
    const shadows = shadowsIn(draft.players, roomId);
    const victims = aliveIn(draft.players, roomId).filter((p) => p.roleId !== "shadow_envoy");
    if (shadows.length === 0 || victims.length === 0) continue;

    // 每名存活玩家受到的吸血 = 同房间暗影数量（暗影吸血不受激光室影响）
    for (const p of victims) {
      const before = p.hp;
      p.hp = Math.max(0, p.hp - shadows.length);
      const dealt = before - p.hp;
      if (dealt > 0) {
        envoyHeals += dealt;
        effects.push({ playerId: p.id, roomId, hpChange: -dealt, reason: `暗影吸血 x${shadows.length}` });
        privateLogs.push({ playerId: p.id, text: `你在 ${getRoomLabel(roomId)} 被暗影吸取 ${dealt} 点生命。` });
      }
    }
    for (const s of shadows) {
      s.shadowDrainCount += victims.length;
      s.lastDrainRoomId = roomId;
      effects.push({ playerId: s.id, roomId, reason: `吸血 +${victims.length}（累计 ${s.shadowDrainCount}）` });
      privateLogs.push({ playerId: s.id, text: `你在 ${getRoomLabel(roomId)} 吸取 ${victims.length} 点生命（累计 ${s.shadowDrainCount}）。` });
    }
    logs.push(`${getRoomLabel(roomId)} 发生暗影吸血。`);
    hostLogs.push(`${getRoomLabel(roomId)}：${shadows.length} 暗影吸取 ${victims.length} 名存活玩家，每人 -${shadows.length}。`);
  }

  // 暗影使者：按本步骤内暗影实际吸到的生命点数恢复。
  if (envoyHeals > 0) {
    for (const p of draft.players) {
      if (p.status === "alive" && p.roleId === "shadow_envoy") {
        const g = heal(p, envoyHeals);
        if (g > 0) {
          effects.push({ playerId: p.id, hpChange: g, reason: "暗影使者：暗影吸血回复" });
          hostLogs.push(`暗影使者 ${nm(p)} 因暗影吸血恢复 ${g} 点生命。`);
          privateLogs.push({ playerId: p.id, text: `你（暗影使者）因暗影吸血恢复 ${g} 点生命。` });
        }
      }
    }
  }

  if (logs.length === 0) logs.push("本轮无暗影吸血。");
  return { type: "shadow", title: "3. 暗影吸血", logs, hostLogs, privateLogs, effects };
}

function stepRocket(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  // §8.3 允许公开「火箭筒袭击的房间」，但不公开发射者与受害者身份/伤害。
  const logs: string[] = [];
  const hostLogs: string[] = [];
  const privateLogs: Array<{ playerId: string; text: string }> = [];

  const shooters = draft.players.filter(
    (p) => p.status === "alive" && p.inventory.includes("rocket") && p.submittedAction?.rocketTargetRoom
  );
  for (const shooter of shooters) {
    const target = shooter.submittedAction!.rocketTargetRoom!;
    const victims = aliveIn(draft.players, target);
    logs.push(`${getRoomLabel(target)} 遭到火箭筒袭击。`);
    hostLogs.push(`${nm(shooter)} 用火箭筒袭击 ${getRoomLabel(target)}。`);
    privateLogs.push({ playerId: shooter.id, text: `你的火箭筒袭击了 ${getRoomLabel(target)}。` });
    for (const v of victims) {
      const dealt = applyDamage(v, 4, round);
      if (dealt > 0) {
        effects.push({ playerId: v.id, roomId: target, hpChange: -dealt, reason: "火箭筒 -4" });
        hostLogs.push(`  ${nm(v)} 扣 ${dealt} 点生命。`);
        privateLogs.push({ playerId: v.id, text: `你在 ${getRoomLabel(target)} 被火箭筒袭击，扣 ${dealt} 点生命。` });
      }
    }
  }

  if (logs.length === 0) logs.push("本轮无火箭筒袭击。");
  return { type: "rocket", title: "4. 火箭筒", logs, hostLogs, privateLogs, effects };
}

function stepGas(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];
  const hostLogs: string[] = [];
  const privateLogs: Array<{ playerId: string; text: string }> = [];

  // 统计投票产生新毒气楼层
  const { newFloors, tally } = tallyGasVotes(draft.players, draft.gasFloors);
  if (newFloors.length > 0) {
    draft.gasFloors = [...draft.gasFloors, ...newFloors];
    // §5：公开只显示最终成为毒气的楼层，不显示票数、不显示谁投了哪里。
    logs.push(`本轮毒气楼层：${newFloors.map(getFloorLabel).join("、")}。`);
  } else {
    logs.push("本轮未产生新的毒气楼层。");
  }
  // 票数明细仅房主裁判可见（§5.3）。
  const tallyText = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${getFloorLabel(f)}:${n}`)
    .join("，");
  if (tallyText) hostLogs.push(`毒气计票（裁判）：${tallyText}`);
  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    const vote = p.submittedAction?.gasVoteFloor;
    if (vote) hostLogs.push(`${nm(p)} 投票毒气楼层：${getFloorLabel(vote)}。`);
  }

  // 化学家本轮毒气修正（规则 3.2）：chemist_plus 全局 +2；chemist_minus 指定房间 -2（最低 0）。
  // 化学家行动属隐藏信息，且 chemist_minus 会指向具体房间——只进裁判明细，不进公开日志。
  const baseDmg = roundGasDamage[round] ?? 0;
  let globalPlus = 0;
  const minusRooms = new Set<string>();
  for (const p of draft.players) {
    if (p.status !== "alive" || p.roleId !== "chemist") continue;
    const sk = p.submittedAction?.roleSkill;
    if (sk?.type === "chemist_plus") {
      globalPlus += 2;
      hostLogs.push(`化学家 ${nm(p)} 使本轮毒气楼层伤害 +2。`);
    } else if (sk?.type === "chemist_minus" && sk.targetRoom) {
      minusRooms.add(sk.targetRoom);
      hostLogs.push(`化学家 ${nm(p)} 使 ${getRoomLabel(sk.targetRoom)} 本轮毒气伤害 -2（最低 0）。`);
    }
  }

  // 毒气伤害：会暴露玩家位置——逐人扣血只进裁判明细与本人私密，不进公开日志。
  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    const room = roomOf(p);
    if (!isRoomGassed(room, draft.gasFloors, draft.clearedGasRooms)) continue;
    // 免疫：防毒面具 / 停机坪 / 复活当轮
    if (p.inventory.includes("gasmask")) continue;
    if (room === "202") continue;
    if (p.reviveProtectedRound === round) continue;

    let dmg = baseDmg + globalPlus;
    if (minusRooms.has(room)) dmg = Math.max(0, dmg - 2);
    if (dmg <= 0) continue;

    const dealt = applyDamage(p, dmg, round);
    if (dealt > 0) {
      effects.push({ playerId: p.id, roomId: room, hpChange: -dealt, reason: `毒气 -${dmg}` });
      hostLogs.push(`${nm(p)} 在 ${getRoomLabel(room)} 受毒气伤害 -${dealt}。`);
      privateLogs.push({ playerId: p.id, text: `你在 ${getRoomLabel(room)} 受毒气伤害 -${dealt}。` });
    }
  }

  return { type: "gas", title: "5. 毒气", logs, hostLogs, privateLogs, effects };
}

function stepWaterFood(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  // §4.3：水粮扣血、餐厅免除都会暴露位置——逐人明细只进裁判与本人私密，不进公开日志。
  const logs: string[] = [];
  const hostLogs: string[] = [];
  const privateLogs: Array<{ playerId: string; text: string }> = [];

  if (round < FOOD_WATER_START_ROUND) {
    logs.push(`${formatRoundLabel(round)}无需上交水粮（从${formatRoundLabel(FOOD_WATER_START_ROUND)}开始）。`);
    return { type: "foodWater", title: "6. 水粮", logs, hostLogs, privateLogs, effects };
  }

  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    const room = roomOf(p);
    // 免除：餐厅（需房间功能未被黑客关闭，§6）/ 复活当轮
    if (room === "B204" && !isRoomFunctionDisabledForResolution("B204", draft)) {
      hostLogs.push(`${nm(p)} 在餐厅(B204) 免上交水粮。`);
      privateLogs.push({ playerId: p.id, text: "你在餐厅(B204) 本轮免上交水粮。" });
      continue;
    }
    if (p.reviveProtectedRound === round) {
      hostLogs.push(`${nm(p)} 复活当轮免上交水粮。`);
      privateLogs.push({ playerId: p.id, text: "你复活当轮免上交水粮。" });
      continue;
    }

    // v1.0.4：水粮在结算阶段私密选择，并在本轮水粮步骤当场生效。
    const wantW = !!p.submittedAction?.submitWater;
    const wantF = !!p.submittedAction?.submitFood;
    const okW = wantW && removeOne(p, "water");
    const okF = wantF && removeOne(p, "food");
    if (okW) consume(draft, "water");
    if (okF) consume(draft, "food");
    if (wantW && !okW) privateLogs.push({ playerId: p.id, text: "你预交了水，但结算时库存不足。" });
    if (wantF && !okF) privateLogs.push({ playerId: p.id, text: "你预交了粮食，但结算时库存不足。" });

    const d = waterFoodDamage(okW, okF);
    if (d > 0) {
      const dealt = applyDamage(p, d, round);
      effects.push({ playerId: p.id, roomId: room, hpChange: -dealt, reason: `水粮不足 -${d}` });
      hostLogs.push(`${nm(p)} 水粮不足（水${okW ? "✓" : "✗"}粮${okF ? "✓" : "✗"}），扣 ${dealt} 点生命。`);
      privateLogs.push({ playerId: p.id, text: `你水粮不足（水${okW ? "✓" : "✗"}粮${okF ? "✓" : "✗"}），扣 ${dealt} 点生命。` });
    } else {
      hostLogs.push(`${nm(p)} 上交水+粮，不扣血。`);
      privateLogs.push({ playerId: p.id, text: "你已上交水+粮，本轮不因水粮扣血。" });
    }
  }
  return { type: "foodWater", title: "6. 水粮", logs, hostLogs, privateLogs, effects };
}

function stepItems(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];
  const hostLogs: string[] = [];
  const privateLogs: Array<{ playerId: string; text: string }> = [];

  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    const uses = (p.submittedAction?.useItems ?? []).map(normalizeItemId);
    // 饮品师果汁多目标：每瓶一个 assignment（目标 + 3 骰面），按使用顺序逐瓶消费。
    const skill0 = p.submittedAction?.roleSkill;
    const juiceAssignments =
      skill0?.type === "juice" && skill0.juiceAssignments ? [...skill0.juiceAssignments] : [];
    for (const id of uses) {
      if (!p.inventory.includes(id)) continue;
      if (id === "pill") {
        removeOne(p, "pill");
        consume(draft, "pill");
        const g = heal(p, 2);
        effects.push({ playerId: p.id, itemId: id, hpChange: g, reason: "药片 +2" });
        logs.push(`${nm(p)} 使用药片，生命 +${g}。`);
      } else if (id === "adrenaline") {
        removeOne(p, "adrenaline");
        consume(draft, "adrenaline");
        p.pendingAdrenalineRound = round + 1;
        effects.push({ playerId: p.id, itemId: id, reason: "肾上腺素：下一轮生效" });
        logs.push(`${nm(p)} 使用肾上腺素，将于${formatRoundLabel(round + 1)}生效（速度 10、伤害最低降至 1）。`);
      } else if (id === "juice") {
        // 饮品师可对其他玩家使用果汁，并按使用瓶数分配多个目标，每瓶可各选 3 个骰面再随机取 1。
        const skill = p.roleId === "bartender" ? p.submittedAction?.roleSkill : undefined;
        const assignment = juiceAssignments.shift(); // 本瓶对应的目标/骰面（按使用顺序逐瓶取）
        removeOne(p, "juice");
        consume(draft, "juice");

        let target = p;
        const targetId = assignment?.targetPlayerId ?? (skill?.type === "juice" ? skill.targetPlayerIds?.[0] : undefined);
        if (targetId) {
          const t = draft.players.find((x) => x.id === targetId && x.status === "alive");
          if (t) target = t;
        }
        const faces = (assignment?.diceFaces ?? (skill?.type === "juice" ? skill.diceFaces : undefined))?.filter((f) => f >= 1 && f <= 6);
        const pool = faces && faces.length > 0 ? faces : [1, 2, 3, 4, 5, 6];
        const dice = pool[Math.floor(Math.random() * pool.length)];
        const r = applyJuice(draft, target, dice);
        effects.push({ playerId: target.id, itemId: id, hpChange: r.hpChange, reason: `果汁掷骰 ${dice}：${r.text}` });
        logs.push(
          target.id === p.id
            ? `${nm(p)} 使用果汁，掷出 ${dice}：${r.text}。`
            : `饮品师 ${nm(p)} 对 ${nm(target)} 使用果汁，掷出 ${dice}：${r.text}。`
        );
      }
      // 其他道具（武器/装备/火箭筒/防毒面具/次元口袋）为持有生效，不在此处理
    }
  }

  // 慈善家赠予（结算阶段，规则 3.2 / v1.0.3 §1）：赠出 1 张道具给存活玩家；
  // 被赠予玩家须「自行选择」转出 1 点基因——此处只成立赠予并挂起待处理选择（pendingGiftFrom），
  // 由被赠予玩家在面板选择基因后（chooseGiftGene）才完成基因转移。
  for (const charity of draft.players) {
    if (charity.status !== "alive" || charity.roleId !== "philanthropist") continue;
    const sk = charity.submittedAction?.roleSkill;
    if (sk?.type !== "gift" || !sk.giveItemId || !sk.targetPlayerIds?.[0]) continue;
    const target = draft.players.find((p) => p.id === sk.targetPlayerIds![0]);
    if (!target || target.status !== "alive" || target.id === charity.id) continue;
    if (target.giftedDone) {
      hostLogs.push(`慈善家 ${nm(charity)} 的赠予失败：${nm(target)} 本局已被赠予过。`);
      continue;
    }
    // §5.3：负重 0 无次元口袋的对方不能获得次元口袋——赠予失败。
    if (!canGainItem(target, sk.giveItemId).ok) {
      hostLogs.push(`慈善家 ${nm(charity)} 的赠予失败：${nm(target)} 负重为 0 无法获得次元口袋。`);
      privateLogs.push({ playerId: charity.id, text: "你的赠予失败：对方负重为 0 无法获得次元口袋。" });
      continue;
    }
    const giftIndex = sk.giveItemIndex;
    const removedGift =
      giftIndex !== undefined && charity.inventory[giftIndex] === sk.giveItemId
        ? charity.inventory.splice(giftIndex, 1)[0]
        : removeOne(charity, sk.giveItemId)
          ? sk.giveItemId
          : null;
    if (!removedGift) {
      hostLogs.push(`慈善家 ${nm(charity)} 的赠予失败：未持有该道具。`);
      continue;
    }
    target.inventory.push(removedGift); // 可短暂超过负重
    target.giftedDone = true;
    target.pendingGiftFrom = charity.id; // 挂起：由被赠予玩家自行选择转出哪项基因
    hostLogs.push(`慈善家 ${nm(charity)} 赠予 ${nm(target)} 1 张${getItemName(removedGift)}。`);
    logs.push(`慈善家向【${nm(target)}】赠予了 1 张道具。`);
    privateLogs.push({ playerId: target.id, text: `你被慈善家(${nm(charity)}) 赠予 1 张${getItemName(removedGift)}，请在面板选择转移 1 点基因（武力/速度/负重，须 >0）给对方。` });
    privateLogs.push({ playerId: charity.id, text: `你赠予 ${nm(target)} 1 张${getItemName(removedGift)}，等待对方选择转移 1 点基因。` });
  }

  // 职业待恢复生命（催眠师/预言家技能产生，规则 3.2）
  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    const pending = p.roleHealPending ?? 0;
    if (pending > 0) {
      const g = heal(p, pending);
      p.roleHealPending = 0;
      if (g > 0) {
        effects.push({ playerId: p.id, hpChange: g, reason: "职业技能回复" });
        hostLogs.push(`${nm(p)} 因职业技能恢复 ${g} 点生命。`);
        privateLogs.push({ playerId: p.id, text: `你因职业技能恢复 ${g} 点生命。` });
      }
    }
  }

  if (logs.length === 0) logs.push("本轮无道具回血/状态结算。");
  return { type: "itemStatus", title: "7. 道具回血 / 状态", logs, hostLogs, privateLogs, effects };
}

/** 果汁掷骰效果（规则 15.2，原「酒」） */
function applyJuice(draft: GameRoom, p: Player, dice: number): { text: string; hpChange?: number } {
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
  // §8.3：公开「哪些玩家成为暗影 / 哪些暗影将复活」，但复活房间属隐藏信息——只进裁判/私密。
  const logs: string[] = [];
  const hostLogs: string[] = [];
  const privateLogs: Array<{ playerId: string; text: string }> = [];

  const morticiansGrabbed = new Set<string>(); // 入殓师每轮最多获得 1 张

  // 死亡检查：存活且生命 0 → 暗影
  for (const p of draft.players) {
    if (p.status !== "alive") continue;
    if (p.hp > 0) continue;
    const room = roomOf(p);

    // 入殓师：每当有玩家变暗影，负重永久 +1（规则 3.2）
    for (const m of draft.players) {
      if (m.status === "alive" && m.roleId === "mortician") {
        m.load += 1;
        hostLogs.push(`入殓师 ${nm(m)} 负重永久 +1（因 ${nm(p)} 变成暗影）。`);
        privateLogs.push({ playerId: m.id, text: "有玩家变成暗影，你（入殓师）负重永久 +1。" });
      }
    }

    // 入殓师：遗物进入停尸间前，可随机获得 1 张（每轮最多 1 张）；负重 0 无次元口袋时跳过次元口袋。
    let relics = [...p.inventory];
    const grabber = draft.players.find(
      (m) => m.status === "alive" && m.roleId === "mortician" && !morticiansGrabbed.has(m.id)
    );
    if (grabber && relics.length > 0) {
      const grabbable = relics.filter((id) => canGainItem(grabber, id).ok);
      if (grabbable.length > 0) {
        const got = grabbable[Math.floor(Math.random() * grabbable.length)];
        relics.splice(relics.indexOf(got), 1);
        grabber.inventory.push(got);
        morticiansGrabbed.add(grabber.id);
        hostLogs.push(`入殓师 ${nm(grabber)} 从 ${nm(p)} 的遗物中获得 1 张${getItemName(got)}。`);
        privateLogs.push({ playerId: grabber.id, text: `你（入殓师）从遗物中获得 1 张${getItemName(got)}。` });
      }
    }

    // 病毒携带者：被感染者变暗影，存活的病毒携带者恢复等于感染层数的生命（规则 3.2）
    const infection = p.infection ?? 0;
    if (infection > 0) {
      for (const c of draft.players) {
        if (c.status === "alive" && c.roleId === "carrier") {
          const g = heal(c, infection);
          if (g > 0) {
            hostLogs.push(`病毒携带者 ${nm(c)} 因感染者 ${nm(p)} 变暗影恢复 ${g} 点生命。`);
            privateLogs.push({ playerId: c.id, text: `有感染者变暗影，你（病毒携带者）恢复 ${g} 点生命。` });
          }
        }
      }
      p.infection = 0;
    }

    // 预言家：被预告者本轮变暗影 → 预言家 +1 生命、获得 2 点待分配基因（规则 3.2）
    for (const prophetId of p.forecastedBy ?? []) {
      const prophet = draft.players.find((x) => x.id === prophetId);
      if (prophet && prophet.status === "alive") {
        const g = heal(prophet, 1);
        prophet.pendingGenePoints = (prophet.pendingGenePoints ?? 0) + 2;
        hostLogs.push(`预言家 ${nm(prophet)} 的死亡预告应验（${nm(p)} 变暗影）：恢复 ${g} 点生命，获得 2 点待分配基因。`);
        privateLogs.push({ playerId: prophet.id, text: "你的死亡预告应验：恢复 1 点生命并获得 2 点待分配基因。" });
      }
    }

    // 遗物进入停尸间
    let tomb = draft.roomInventories["B701"] ?? {};
    for (const id of relics) tomb = invAdd(tomb, id, 1);
    draft.roomInventories["B701"] = tomb;

    p.inventory = [];
    p.status = "shadow";
    p.previousLocation = room;
    p.location = "B701"; // 下一轮从停尸间出发
    p.submittedAction = null;
    p.shadowDrainCount = 0;
    p.reviveNextRound = false;
    p.forecastedBy = [];
    effects.push({ playerId: p.id, statusChange: "shadow", reason: "生命归 0，变成暗影" });
    // 公开「成为暗影」（规则允许），不暴露其死亡所在房间。
    logs.push(`${nm(p)} 生命归 0，变成暗影，遗物进入停尸间(B701)。`);
  }

  // 复活检查：暗影累计吸血 >= 2 → 下一轮复活。复活房间属隐藏信息，仅本人/裁判可见。
  for (const p of draft.players) {
    if (p.status !== "shadow") continue;
    if (p.shadowDrainCount >= 2 && p.lastDrainRoomId) {
      p.reviveNextRound = true;
      p.reviveProtectedRound = round + 1;
      effects.push({ playerId: p.id, reason: `满足复活：下一轮在 ${getRoomLabel(p.lastDrainRoomId)} 复活，生命 ${p.shadowDrainCount}` });
      logs.push(`${nm(p)} 将于${formatRoundLabel(round + 1)}复活。`);
      hostLogs.push(`${nm(p)} 累计吸血 ${p.shadowDrainCount}，将于${formatRoundLabel(round + 1)}在 ${getRoomLabel(p.lastDrainRoomId)} 复活（生命 ${p.shadowDrainCount}）。`);
      privateLogs.push({ playerId: p.id, text: `你将于${formatRoundLabel(round + 1)}在 ${getRoomLabel(p.lastDrainRoomId)} 复活，生命 ${p.shadowDrainCount}。` });
    }
  }

  if (logs.length === 0) logs.push("本轮无玩家死亡或复活。");
  return { type: "deathRevive", title: "8. 死亡 / 复活检查", logs, hostLogs, privateLogs, effects };
}

/**
 * 最终生命值汇总（v1.0.3 §4.2）：所有结算步骤完成后，统一公开每名玩家的最终生命值。
 * 这是结算阶段唯一公开逐人生命的地方——过程中的逐人伤害不公开，避免反推位置。
 */
function stepFinalHp(draft: GameRoom): ResolutionStep {
  const logs: string[] = [];
  const ordered = draft.players.filter((p) => p.name);
  for (const p of ordered) {
    logs.push(`${nm(p)}：${p.hp} 点生命${p.status === "shadow" ? "（暗影）" : ""}。`);
  }
  if (logs.length === 0) logs.push("无玩家。");
  return { type: "finalHp", title: "9. 最终生命值（统一公开）", logs, effects: [] };
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
    stepFinalHp(draft),
  ];

  draft.resolutionPreview = null; // 避免嵌套
  return {
    round,
    steps,
    nextRoom: draft,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 首轮出生战斗结算（v1.0.4）：只结算出生房间内的战斗 / 乱斗，然后做死亡 / 复活检查与最终生命值公开。
 * 不触发移动、抽卡、房间功能、交易、毒气、水粮、职业主动技能、火箭筒或其他结算步骤。
 */
export function buildSpawnCombatPreview(room: GameRoom): ResolutionPreview {
  const draft = clone(room);
  const steps: ResolutionStep[] = [
    stepCombat(draft, 0, false),
    stepDeathRevive(draft, 0),
    stepFinalHp(draft),
  ];
  draft.resolutionPreview = null;
  return {
    round: 0,
    steps,
    nextRoom: draft,
    generatedAt: new Date().toISOString(),
  };
}
