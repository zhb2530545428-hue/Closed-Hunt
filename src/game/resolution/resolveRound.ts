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
import { getItemName, weaponBonusOf, isWeaponItem, normalizeItemId } from "../config/items";
import { invAdd } from "../inventory";
import { isRoomGassed } from "../gas";
import { computeCombatDamage, type Combatant } from "./combat";
import { tallyGasVotes } from "./gasVote";
import { waterFoodDamage } from "./waterFood";
import { roleHasGun } from "../engine/roleEffects";
import { pathTriggersLaser } from "../utils/movement";

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
  return roleHasGun(p);
}

// —— 各步骤 ——

function stepRoomEffects(draft: GameRoom, round: number): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];
  const alive = draft.players.filter((p) => p.status === "alive");

  // 102 激光室（规则 7.3 经过型效果）：存活玩家本轮路径经过/停留 102 → -1 生命（暗影不受影响）。
  // v1.0.1（§8）：行动阶段不再即时扣血，统一在结算「房间效果」步骤处理。
  // 经过型效果不受黑客关闭房间影响。
  for (const p of alive) {
    if (!pathTriggersLaser(p.submittedAction?.path, p.status)) continue;
    const dealt = applyDamage(p, 1, round);
    if (dealt > 0) {
      effects.push({ playerId: p.id, roomId: "102", hpChange: -dealt, reason: "激光室 -1" });
      logs.push(`${p.name} 经过/停留 102 激光室，扣 ${dealt} 点生命。`);
    }
  }

  for (const p of alive) {
    const room = roomOf(p);
    // 黑客关闭的房间本轮无法触发房间效果
    if (draft.closedRooms?.includes(room)) continue;
    // 基因库 201：选择使用则三项 +1（规则 14.1，轻量版）
    if (room === "201" && p.submittedAction?.roomAction === "gene") {
      p.force += 1;
      p.speed += 1;
      p.load += 1;
      effects.push({ playerId: p.id, roomId: room, reason: "基因库：武力/速度/负重各 +1" });
      logs.push(`${p.name} 在基因库(201) 三项属性各 +1。`);
    }
  }

  // 手术室 B202：恰好 2 人，每人 +4 且不战斗（规则 14.1）；被黑客关闭则失效
  const surgery = draft.closedRooms?.includes("B202") ? [] : aliveIn(draft.players, "B202");
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
    // 手术室恰好 2 人不战斗（已在房间效果 +4）；被黑客关闭则照常战斗
    if (roomId === "B202" && fighters.length === 2 && !draft.closedRooms?.includes("B202")) continue;

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

  // 病毒携带者：与战斗同时结算。同房间其他存活玩家额外扣 N（其他存活数）并叠加感染标记；
  // 初始轮（第 1 轮）仅叠加标记，无伤害。规则 3.2。
  const carriers = draft.players.filter((p) => p.status === "alive" && p.roleId === "carrier");
  for (const carrier of carriers) {
    const room = roomOf(carrier);
    const others = aliveIn(draft.players, room).filter((p) => p.id !== carrier.id);
    if (others.length === 0) continue;
    const n = others.length;
    logs.push(`病毒携带者 ${carrier.name} 在 ${getRoomLabel(room)} 对 ${n} 名存活玩家施加感染${round <= 1 ? "（初始轮仅标记）" : `（各 -${n}）`}。`);
    for (const v of others) {
      v.infection = (v.infection ?? 0) + 1;
      if (round > 1) {
        const dealt = applyDamage(v, n, round);
        effects.push({ playerId: v.id, roomId: room, hpChange: -dealt, reason: `病毒感染 -${n}` });
        logs.push(`  ${v.name} 受感染扣 ${dealt} 点生命（感染层数 ${v.infection}）。`);
      } else {
        logs.push(`  ${v.name} 叠加感染标记（层数 ${v.infection}）。`);
      }
    }
  }

  if (logs.length === 0) logs.push("本轮无战斗或乱斗。");
  return { type: "combat", title: "2. 战斗 / 乱斗", logs, effects };
}

function stepShadow(draft: GameRoom): ResolutionStep {
  const effects: ResolutionEffect[] = [];
  const logs: string[] = [];

  // 暗影使者免疫被吸血（不计入被吸对象，暗影也不因其增加吸血量）。规则 3.2。
  let envoyHeals = 0; // 本步骤内暗影吸血「次数」，每次令存活的暗影使者 +1

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
        effects.push({ playerId: p.id, roomId, hpChange: -dealt, reason: `暗影吸血 x${shadows.length}` });
      }
    }
    for (const s of shadows) {
      s.shadowDrainCount += victims.length;
      s.lastDrainRoomId = roomId;
      envoyHeals += victims.length; // 每名暗影对每名存活玩家各吸 1，计为一次吸血事件
      effects.push({ playerId: s.id, roomId, reason: `吸血 +${victims.length}（累计 ${s.shadowDrainCount}）` });
    }
    logs.push(
      `${getRoomLabel(roomId)}：${shadows.length} 暗影吸取 ${victims.length} 名存活玩家，每人 -${shadows.length}。`
    );
  }

  // 暗影使者：存活状态下，每当其他暗影吸取生命，恢复 1 点生命（按吸血事件计）。
  if (envoyHeals > 0) {
    for (const p of draft.players) {
      if (p.status === "alive" && p.roleId === "shadow_envoy") {
        const g = heal(p, envoyHeals);
        if (g > 0) {
          effects.push({ playerId: p.id, hpChange: g, reason: "暗影使者：暗影吸血回复" });
          logs.push(`暗影使者 ${p.name} 因暗影吸血恢复 ${g} 点生命。`);
        }
      }
    }
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

  // 化学家本轮毒气修正（规则 3.2）：chemist_plus 全局 +2；chemist_minus 指定房间 -2（最低 0）。
  const baseDmg = roundGasDamage[round] ?? 0;
  let globalPlus = 0;
  const minusRooms = new Set<string>();
  for (const p of draft.players) {
    if (p.status !== "alive" || p.roleId !== "chemist") continue;
    const sk = p.submittedAction?.roleSkill;
    if (sk?.type === "chemist_plus") {
      globalPlus += 2;
      logs.push(`化学家 ${p.name} 使本轮毒气楼层伤害 +2。`);
    } else if (sk?.type === "chemist_minus" && sk.targetRoom) {
      minusRooms.add(sk.targetRoom);
      logs.push(`化学家 ${p.name} 使 ${getRoomLabel(sk.targetRoom)} 本轮毒气伤害 -2（最低 0）。`);
    }
  }

  // 毒气伤害
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
        logs.push(`${p.name} 使用药片，生命 +${g}。`);
      } else if (id === "adrenaline") {
        removeOne(p, "adrenaline");
        consume(draft, "adrenaline");
        p.pendingAdrenalineRound = round + 1;
        effects.push({ playerId: p.id, itemId: id, reason: "肾上腺素：下一轮生效" });
        logs.push(`${p.name} 使用肾上腺素，将于第 ${round + 1} 轮生效（速度 10、伤害最低降至 1）。`);
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
            ? `${p.name} 使用果汁，掷出 ${dice}：${r.text}。`
            : `饮品师 ${p.name} 对 ${target.name} 使用果汁，掷出 ${dice}：${r.text}。`
        );
      }
      // 其他道具（武器/装备/火箭筒/防毒面具/次元口袋）为持有生效，不在此处理
    }
  }

  // 慈善家赠予（结算阶段，规则 3.2）：赠出 1 张道具给存活玩家，换取其 1 点基因。
  for (const charity of draft.players) {
    if (charity.status !== "alive" || charity.roleId !== "philanthropist") continue;
    const sk = charity.submittedAction?.roleSkill;
    if (sk?.type !== "gift" || !sk.giveItemId || !sk.targetPlayerIds?.[0]) continue;
    const target = draft.players.find((p) => p.id === sk.targetPlayerIds![0]);
    if (!target || target.status !== "alive" || target.id === charity.id) continue;
    if (target.giftedDone) {
      logs.push(`慈善家 ${charity.name} 的赠予失败：${target.name} 本局已被赠予过。`);
      continue;
    }
    if (!removeOne(charity, sk.giveItemId)) {
      logs.push(`慈善家 ${charity.name} 的赠予失败：未持有该道具。`);
      continue;
    }
    target.inventory.push(sk.giveItemId); // 可短暂超过负重
    target.giftedDone = true;
    // 对方公开转移 1 点基因给慈善家（默认转出最高的非 0 基因；交互式选择见 roles.ts 说明）
    const genes: Array<["force" | "speed" | "load", number]> = [
      ["force", target.force],
      ["speed", target.speed],
      ["load", target.load],
    ];
    const pick = genes.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
    if (pick) {
      target[pick[0]] -= 1;
      charity[pick[0]] += 1;
      const gname = pick[0] === "force" ? "武力" : pick[0] === "speed" ? "速度" : "负重";
      logs.push(
        `慈善家 ${charity.name} 赠予 ${target.name} 1 张${getItemName(sk.giveItemId)}；${target.name} 转移 1 点${gname}给 ${charity.name}。`
      );
      effects.push({ playerId: charity.id, reason: `慈善家：获得 1 点${gname}` });
    } else {
      logs.push(`慈善家 ${charity.name} 赠予 ${target.name} 1 张${getItemName(sk.giveItemId)}（对方无可转移基因）。`);
    }
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
        logs.push(`${p.name} 因职业技能恢复 ${g} 点生命。`);
      }
    }
  }

  if (logs.length === 0) logs.push("本轮无道具回血/状态结算。");
  return { type: "itemStatus", title: "7. 道具回血 / 状态", logs, effects };
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
  const logs: string[] = [];

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
        logs.push(`入殓师 ${m.name} 负重永久 +1（因 ${p.name} 变成暗影）。`);
      }
    }

    // 入殓师：遗物进入停尸间前，可随机获得 1 张（每轮最多 1 张）
    let relics = [...p.inventory];
    const grabber = draft.players.find(
      (m) => m.status === "alive" && m.roleId === "mortician" && !morticiansGrabbed.has(m.id)
    );
    if (grabber && relics.length > 0) {
      const idx = Math.floor(Math.random() * relics.length);
      const got = relics.splice(idx, 1)[0];
      grabber.inventory.push(got);
      morticiansGrabbed.add(grabber.id);
      logs.push(`入殓师 ${grabber.name} 从 ${p.name} 的遗物中获得 1 张${getItemName(got)}。`);
    }

    // 病毒携带者：被感染者变暗影，存活的病毒携带者恢复等于感染层数的生命（规则 3.2）
    const infection = p.infection ?? 0;
    if (infection > 0) {
      for (const c of draft.players) {
        if (c.status === "alive" && c.roleId === "carrier") {
          const g = heal(c, infection);
          if (g > 0) logs.push(`病毒携带者 ${c.name} 因感染者 ${p.name} 变暗影恢复 ${g} 点生命。`);
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
        logs.push(`预言家 ${prophet.name} 的死亡预告应验（${p.name} 变暗影）：恢复 ${g} 点生命，获得 2 点待分配基因。`);
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
