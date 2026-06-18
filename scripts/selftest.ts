// 核心结算纯函数自测。运行：npm test
// 覆盖开发指令第 6 节：战斗 / 毒气 / 水粮 / 暗影 / 库存。

import assert from "node:assert";
import type { GameRoom, Player } from "../src/game/types";
import { computeCombatDamage } from "../src/game/resolution/combat";
import { tallyGasVotes } from "../src/game/resolution/gasVote";
import { waterFoodDamage } from "../src/game/resolution/waterFood";
import { buildResolutionPreview } from "../src/game/resolution/resolveRound";
import { isRoomGassed } from "../src/game/gas";
import { getInventoryWeight, getCarryLimit, isOverweight } from "../src/game/inventory";
import { validateMapGraph } from "../src/game/config/mapGraph";
import { getReachableRooms, validateMove, type MoveContext } from "../src/game/utils/movement";
import { applyRoleSetup, roleHasGun, applyDeclaredSkill, chooseGiftGene, submitHypnosisDecision } from "../src/game/engine/roleEffects";
import { createTrade, respondTrade, validateTurnOrderCards } from "../src/game/engine/trade";
import { computeRanking, applyFinalGoldConversion } from "../src/game/resolution/ranking";
import { resolveRoleAssignments, fillTestPlayers, addRandomTestPlayer, isGeneValid, validateInitialGenes } from "../src/game/engine/lobby";
import { canStartGame, startGame } from "../src/game/engine/startGame";
import { currentTurnPlayerId, endTurn, confirmResolution, generateResolutionPreview, goToPhase } from "../src/game/engine/advancePhase";
import { submitAction, reviseAction, chooseResolutionResources, reallocateGenesAtOperationRoom } from "../src/game/engine/submitAction";
import { drawItemsFromRoom, skipDraw } from "../src/game/engine/draw";
import { canGainItem } from "../src/game/inventory";
import { isRoomFunctionAvailable, isRoomFunctionDisabledForAction, isRoomFunctionDisabledForResolution } from "../src/game/config/roomFunctions";
import { formatRoundLabel } from "../src/game/config/rounds";
import { createGame } from "../src/game/engine/createGame";
import { assertSettlementConfirmationsReady, missingSettlementConfirmers } from "../src/game/engine/settlementConfirmation";
import { DEFAULT_MAP_CONNECTIONS, makeConnectionId } from "../src/game/config/mapConnections";
import { DEFAULT_MAP_LAYOUT } from "../src/game/config/mapLayout";
import { shortestPath, validateMapData } from "../src/game/utils/mapEditor";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}

function makePlayer(p: Partial<Player> & { id: string }): Player {
  return {
    id: p.id,
    name: p.name ?? p.id,
    seatIndex: p.seatIndex ?? 0,
    preferredRoleId: p.preferredRoleId ?? p.roleId ?? null,
    roleId: p.roleId ?? null,
    hp: p.hp ?? 10,
    maxHp: p.maxHp ?? 10,
    force: p.force ?? 0,
    speed: p.speed ?? 5,
    load: p.load ?? 5,
    location: p.location ?? null,
    previousLocation: p.previousLocation ?? null,
    status: p.status ?? "alive",
    inventory: p.inventory ?? [],
    orderCard: p.orderCard ?? null,
    shadowDrainCount: p.shadowDrainCount ?? 0,
    lastRoundHp: p.lastRoundHp,
    endedAction: p.endedAction,
    waterPledged: p.waterPledged,
    foodPledged: p.foodPledged,
    pendingGiftFrom: p.pendingGiftFrom,
    isReady: true,
    submittedAction: p.submittedAction ?? null,
  };
}

function makeRoom(players: Player[], round = 1, gasFloors: string[] = []): GameRoom {
  return {
    id: "r", roomCode: "TEST", status: "RESOLUTION", currentRound: round, currentPhase: "RESOLUTION",
    hostPlayerId: players[0]?.id ?? "h", players, gasFloors, clearedGasRooms: [], closedRooms: [], closedRoomRecords: [], pendingHypnosis: [],
    hypnosisDecisions: [], settlementConfirmations: [],
    roomInventories: {}, consumedPile: {}, airdrops: [], trades: [], resolutionPreview: null,
    publicLogs: [], devMode: true, createdAt: "", updatedAt: "",
  };
}

const at = (id: string, toRoom: string, extra: Partial<Player["submittedAction"]> = {}) =>
  makePlayer({ id, submittedAction: { round: 1, fromRoom: null, toRoom, gasVoteFloor: null, submittedAt: "", ...extra } as Player["submittedAction"] });

// ---------- 6.1 战斗 ----------
console.log("战斗 / 乱斗：");
test("普通 2 人战斗：高战力不扣，低者扣差值", () => {
  const r = computeCombatDamage([{ id: "a", power: 8, hasGun: false }, { id: "b", power: 5, hasGun: false }]);
  assert.equal(r.damage.a, 0);
  assert.equal(r.damage.b, 3);
  assert.equal(r.gunSuppression, false);
});
test("3 人乱斗", () => {
  const r = computeCombatDamage([
    { id: "a", power: 7, hasGun: false }, { id: "b", power: 4, hasGun: false }, { id: "c", power: 2, hasGun: false },
  ]);
  assert.equal(r.damage.a, 0); assert.equal(r.damage.b, 3); assert.equal(r.damage.c, 5);
});
test("并列最高不扣血", () => {
  const r = computeCombatDamage([{ id: "a", power: 6, hasGun: false }, { id: "b", power: 6, hasGun: false }]);
  assert.equal(r.damage.a, 0); assert.equal(r.damage.b, 0);
});
test("枪械压制（规则 9.5 示例）", () => {
  // A霰弹枪8, B手枪6, C刀7, D无5
  const r = computeCombatDamage([
    { id: "A", power: 8, hasGun: true }, { id: "B", power: 6, hasGun: true },
    { id: "C", power: 7, hasGun: false }, { id: "D", power: 5, hasGun: false },
  ]);
  assert.equal(r.gunSuppression, true);
  assert.equal(r.damage.A, 0);   // 最高持枪
  assert.equal(r.damage.B, 2);   // 持枪间普通战斗 8-6
  assert.equal(r.damage.C, 8);   // 无枪吃完整
  assert.equal(r.damage.D, 8);   // 无枪吃完整
});
test("无枪玩家最高时按普通战斗（规则 9.6 示例）", () => {
  // A刀8(无枪最高), B手枪6, C无5
  const r = computeCombatDamage([
    { id: "A", power: 8, hasGun: false }, { id: "B", power: 6, hasGun: true }, { id: "C", power: 5, hasGun: false },
  ]);
  assert.equal(r.gunSuppression, false);
  assert.equal(r.damage.A, 0); assert.equal(r.damage.B, 2); assert.equal(r.damage.C, 3);
});

// ---------- 6.2 毒气 ----------
console.log("毒气：");
test("投票并列最高均成为毒气楼层", () => {
  const ps = [
    at("a", "103", { gasVoteFloor: "B3" }), at("b", "103", { gasVoteFloor: "B3" }),
    at("c", "103", { gasVoteFloor: "B5" }), at("d", "103", { gasVoteFloor: "B5" }),
  ];
  const t = tallyGasVotes(ps, []);
  assert.deepEqual(t.newFloors.sort(), ["B3", "B5"]);
});
test("控制室 1 票视为 10 票", () => {
  const ps = [
    at("a", "B101", { gasVoteFloor: "B1", roomAction: "control_vote10" }),
    at("b", "103", { gasVoteFloor: "B3" }), at("c", "103", { gasVoteFloor: "B3" }),
  ];
  const t = tallyGasVotes(ps, []);
  assert.deepEqual(t.newFloors, ["B1"]);
});
test("已是毒气楼层不再计票", () => {
  const ps = [at("a", "103", { gasVoteFloor: "B3" })];
  const t = tallyGasVotes(ps, ["B3"]);
  assert.equal(t.newFloors.length, 0);
});
test("B501 需 B4 与 B5 都毒气才受影响", () => {
  assert.equal(isRoomGassed("B501", ["B5"], []), false);
  assert.equal(isRoomGassed("B501", ["B4", "B5"], []), true);
  assert.equal(isRoomGassed("B502", ["B5"], []), true); // 同层普通房间
});
test("已解除毒气房间不受影响", () => {
  assert.equal(isRoomGassed("B502", ["B5"], ["B502"]), false);
});

// ---------- 6.3 水粮 ----------
console.log("水粮：");
test("交齐不扣血 / 缺一 -1 / 全缺 -2", () => {
  assert.equal(waterFoodDamage(true, true), 0);
  assert.equal(waterFoodDamage(true, false), 1);
  assert.equal(waterFoodDamage(false, true), 1);
  assert.equal(waterFoodDamage(false, false), 2);
});
test("第 1 轮不触发水粮，第 2 轮不交扣 2", () => {
  const r1 = buildResolutionPreview(makeRoom([at("a", "103", { gasVoteFloor: "B1" })], 1));
  const wf1 = r1.steps.find((s) => s.type === "foodWater")!;
  assert.equal(wf1.effects.length, 0);

  const r2 = buildResolutionPreview(makeRoom([at("a", "103", { gasVoteFloor: "B1", submitWater: false, submitFood: false })], 2));
  assert.equal(r2.nextRoom.players[0].hp, 8); // 10 - 2
});
test("第 2 轮在餐厅 B204 免水粮", () => {
  const r = buildResolutionPreview(makeRoom([at("a", "B204", { gasVoteFloor: "B1" })], 2));
  assert.equal(r.nextRoom.players[0].hp, 10);
});

// ---------- 6.4 暗影 ----------
console.log("暗影：");
test("生命归 0 在结算最后变暗影，遗物进停尸间", () => {
  const dead = makePlayer({ id: "a", hp: 1, inventory: ["knife"], submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: null, submittedAt: "" } });
  // 同房间 2 人战斗，a 武力0、b 武力5 → a 扣 5 → 死亡
  const b = makePlayer({ id: "b", force: 5, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: null, submittedAt: "" } });
  const r = buildResolutionPreview(makeRoom([dead, b], 1));
  const pa = r.nextRoom.players.find((p) => p.id === "a")!;
  assert.equal(pa.status, "shadow");
  assert.equal(pa.location, "B701");
  assert.equal(pa.inventory.length, 0);
  assert.equal((r.nextRoom.roomInventories["B701"] ?? {}).knife, 1);
});
test("暗影同房间吸血，累计 >=2 标记下一轮复活", () => {
  const shadow = makePlayer({ id: "s", status: "shadow", submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: null, submittedAt: "" } });
  const a1 = at("a", "103", { gasVoteFloor: "B1" });
  const a2 = at("b", "103", { gasVoteFloor: "B1" });
  const r = buildResolutionPreview(makeRoom([shadow, a1, a2], 1));
  const ps = r.nextRoom.players.find((p) => p.id === "s")!;
  assert.equal(ps.shadowDrainCount, 2);      // 同房间 2 名存活
  assert.equal(ps.lastDrainRoomId, "103");
  assert.equal(ps.reviveNextRound, true);
  assert.equal(r.nextRoom.players.find((p) => p.id === "a")!.hp, 9); // 各 -1
});

// ---------- 6.5 库存 ----------
console.log("库存 / 负重：");
test("次元口袋持有时负重无限", () => {
  const p = makePlayer({ id: "a", load: 1, inventory: ["pocket", "water", "food", "knife"] });
  assert.equal(getCarryLimit(p), Infinity);
  assert.equal(isOverweight(p), false);
});
test("雇佣兵武器不占负重", () => {
  const merc = makePlayer({ id: "m", roleId: "mercenary", load: 2, inventory: ["knife", "pistol", "water"] });
  assert.equal(getInventoryWeight(merc), 1); // 仅水占重
  const normal = makePlayer({ id: "n", load: 2, inventory: ["knife", "pistol", "water"] });
  assert.equal(getInventoryWeight(normal), 3);
  assert.equal(isOverweight(normal), true);
});
test("药片使用后进入 consumedPile，生命 +2", () => {
  const p = makePlayer({ id: "a", hp: 5, inventory: ["pill"], submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", useItems: ["pill"], submittedAt: "" } });
  const r = buildResolutionPreview(makeRoom([p], 1));
  const pa = r.nextRoom.players[0];
  assert.equal(pa.hp, 7);
  assert.equal(pa.inventory.includes("pill"), false);
  assert.equal(r.nextRoom.consumedPile.pill, 1);
});

// ---------- v0.3 地图移动 ----------
console.log("地图移动：");
const ctx = (fromRoomId: string, speed: number, extra: Partial<MoveContext> = {}): MoveContext => ({
  fromRoomId, speed, status: "alive", hasRope: false, heliEligible: false, ...extra,
});
const ids = (from: string, speed: number, extra?: Partial<MoveContext>) =>
  getReachableRooms(ctx(from, speed, extra)).map((r) => r.roomId);

test("mapGraph 校验通过（房间齐全、邻接双向）", () => {
  assert.deepEqual(validateMapGraph(), []);
});
test("B103 速度 1 可达相邻房间（校准后：仅 B102/B104 相邻）", () => {
  const r = ids("B103", 1);
  for (const x of ["B102", "B104"]) assert.ok(r.includes(x), `应可达 ${x}`);
  assert.ok(!r.includes("B103"), "不含起点");
  // 校准后 102 经 B104 需 2 步、B203 经 B204 更远，速度 1 不可达
  assert.ok(!r.includes("102"), "102 已非 B103 直接相邻");
});
test("超出速度不可达，提速后可达", () => {
  assert.equal(validateMove(ctx("B103", 1), "B101").ok, false);
  assert.equal(validateMove(ctx("B103", 2), "B101").ok, true);
});
test("不能原地停留", () => {
  const v = validateMove(ctx("B103", 3), "B103");
  assert.equal(v.ok, false);
});
test("经过 102 激光室触发提示（存活）", () => {
  // 校准后 B103→102 走 B103→B104→102（楼梯）共 2 步
  const v = validateMove(ctx("B103", 2), "102");
  assert.equal(v.ok, true);
  assert.equal(v.passesLaser, true);
});
test("暗影经过 102 不触发激光", () => {
  const v = validateMove(ctx("B103", 1, { status: "shadow" }), "102");
  assert.equal(v.passesLaser, false);
});
test("B105 → B503 垃圾管道单向", () => {
  const fromB105 = getReachableRooms(ctx("B105", 1)).find((r) => r.roomId === "B503");
  assert.ok(fromB105, "B105 可达 B503");
  assert.ok(fromB105!.specialMoves.includes("trash_chute"));
  assert.ok(!ids("B503", 1).includes("B105"), "B503 不能反向到 B105");
});
test("B403 传送室只能到普通房间", () => {
  const r = ids("B403", 1);
  assert.ok(r.includes("103"), "可传送到普通房间 103");
  assert.ok(!r.includes("B206"), "不能传送到功能房间 B206");
});
test("直升机仅资格时可达指定 5 房间", () => {
  const eligible = ids("202", 1, { heliEligible: true });
  for (const x of ["B101", "101", "B103", "201", "B105"]) assert.ok(eligible.includes(x), `直升机应可达 ${x}`);
  const noHeli = ids("202", 1, { heliEligible: false });
  assert.ok(!noHeli.includes("B101"), "无资格不可直飞 B101");
});
test("绳索使存活玩家可竖向上下楼（不经楼梯）", () => {
  // B102(col1) 与 B202(col1) 竖向对齐，但无显式楼梯；绳索应可达
  const noRope = ids("B102", 1);
  const withRope = ids("B102", 1, { hasRope: true });
  assert.ok(!noRope.includes("B202"), "无绳索不直达 B202");
  assert.ok(withRope.includes("B202"), "持绳索可直达 B202");
});

// ---------- v1.0 职业技能 ----------
console.log("职业技能：");

test("富豪开局金条：金库 -2 大仓库 -1，本人 +3", () => {
  const tycoon = makePlayer({ id: "t", roleId: "tycoon", name: "富豪" });
  const room = makeRoom([tycoon], 1);
  room.roomInventories = { B206: { gold: 4 }, B501: { gold: 1 } };
  const { room: r2 } = applyRoleSetup(room);
  const p = r2.players[0];
  assert.equal(p.inventory.filter((i) => i === "gold").length, 3);
  assert.equal(r2.roomInventories.B206.gold, 2);
  assert.equal(r2.roomInventories.B501.gold ?? 0, 0);
});

test("驯兽师开局武力/负重 +1", () => {
  const bm = makePlayer({ id: "b", roleId: "beastmaster", force: 3, load: 3 });
  const { room: r2 } = applyRoleSetup(makeRoom([bm], 1));
  assert.equal(r2.players[0].force, 4);
  assert.equal(r2.players[0].load, 4);
});

test("雇佣兵持刀视为持枪，普通玩家持刀不算枪", () => {
  assert.equal(roleHasGun(makePlayer({ id: "m", roleId: "mercenary", inventory: ["knife"] })), true);
  assert.equal(roleHasGun(makePlayer({ id: "n", inventory: ["knife"] })), false);
  assert.equal(roleHasGun(makePlayer({ id: "g", inventory: ["pistol"] })), true);
});

test("暗影使者免疫吸血并因吸血回复生命", () => {
  const envoy = makePlayer({ id: "e", roleId: "shadow_envoy", hp: 5, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
  const victim = makePlayer({ id: "v", hp: 5, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
  const shadow = makePlayer({ id: "s", status: "shadow", submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: null, submittedAt: "" } });
  const r = buildResolutionPreview(makeRoom([envoy, victim, shadow], 1));
  assert.equal(r.nextRoom.players.find((p) => p.id === "v")!.hp, 4); // 被吸 1
  assert.equal(r.nextRoom.players.find((p) => p.id === "e")!.hp, 6); // 免疫且回复 1
});

test("暗影使者按暗影实际吸到的生命点数恢复，不按理论事件数超额恢复", () => {
  const envoy = makePlayer({ id: "e", roleId: "shadow_envoy", hp: 5, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
  const victim = makePlayer({ id: "v", hp: 1, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
  const shadowA = makePlayer({ id: "s1", status: "shadow", submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: null, submittedAt: "" } });
  const shadowB = makePlayer({ id: "s2", status: "shadow", submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: null, submittedAt: "" } });
  const r = buildResolutionPreview(makeRoom([envoy, victim, shadowA, shadowB], 1));
  assert.equal(r.nextRoom.players.find((p) => p.id === "v")!.hp, 0);
  assert.equal(r.nextRoom.players.find((p) => p.id === "e")!.hp, 6);
});

test("病毒携带者：第 1 轮仅标记，第 2 轮扣 N", () => {
  const mk = (round: number) => {
    const c = makePlayer({ id: "c", roleId: "carrier", submittedAction: { round, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
    const x = makePlayer({ id: "x", submittedAction: { round, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
    const y = makePlayer({ id: "y", submittedAction: { round, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
    return buildResolutionPreview(makeRoom([c, x, y], round));
  };
  const r1 = mk(1);
  assert.equal(r1.nextRoom.players.find((p) => p.id === "x")!.hp, 10); // 初始轮无伤害
  assert.equal(r1.nextRoom.players.find((p) => p.id === "x")!.infection, 1);
  const r2 = mk(2);
  // 其他存活 2 人 → 各 -2（N=2）；同时第 2 轮还要水粮，但默认未交 → 再 -2。仅验证感染层数与至少受伤。
  assert.equal(r2.nextRoom.players.find((p) => p.id === "x")!.infection, 1);
  assert.ok(r2.nextRoom.players.find((p) => p.id === "x")!.hp <= 8);
});

test("化学家 chemist_plus 使毒气伤害 +2", () => {
  // 第 2 轮毒气基础 -2；+2 → -4。结算阶段上交水粮，避免额外扣血。
  const chem = makePlayer({ id: "c", roleId: "chemist", inventory: ["water", "food"], submittedAction: { round: 2, fromRoom: null, toRoom: "B302", gasVoteFloor: "B3", submitWater: true, submitFood: true, roleSkill: { type: "chemist_plus" }, submittedAt: "" } });
  const room = makeRoom([chem], 2, ["B3"]);
  const r = buildResolutionPreview(room);
  assert.equal(r.nextRoom.players[0].hp, 6);
});

test("意见领袖额外票权（N×2+1）压过普通票", () => {
  const inf = at("inf", "103", { gasVoteFloor: "B1" });
  inf.roleId = "influencer";
  const a = at("a", "103", { gasVoteFloor: "B3" });
  const b = at("b", "103", { gasVoteFloor: "B3" });
  // 3 人在座：意见领袖权重 = 1 + (3-1)*2 = 5，压过 B3 的 2 票
  const t = tallyGasVotes([inf, a, b], []);
  assert.deepEqual(t.newFloors, ["B1"]);
});

test("预言家没有意见领袖的额外毒气票权", () => {
  const prophet = at("prophet", "103", { gasVoteFloor: "B1" });
  prophet.roleId = "prophet";
  const a = at("a", "103", { gasVoteFloor: "B3" });
  const b = at("b", "103", { gasVoteFloor: "B3" });
  const t = tallyGasVotes([prophet, a, b], []);
  assert.deepEqual(t.newFloors, ["B3"]);
  assert.equal(t.tally.B1, 1);
});

test("催眠师 applyDeclaredSkill 创建 pendingHypnosis 并消耗次数", () => {
  const hyp = makePlayer({ id: "h", roleId: "hypnotist", location: "B102", submittedAction: { round: 1, fromRoom: null, toRoom: "B102", gasVoteFloor: "B1", roleSkill: { type: "charm", targetPlayerIds: ["v"], targetRoom: "B102" }, submittedAt: "" } });
  const victim = makePlayer({ id: "v", location: "B103" }); // B103→B102 相邻 1 步
  const room = makeRoom([hyp, victim], 1);
  const res = applyDeclaredSkill(room, "h");
  const t = res.room.players.find((p) => p.id === "v")!;
  const me = res.room.players.find((p) => p.id === "h")!;
  assert.equal(res.room.pendingHypnosis?.[0].forcedRoomId, "B102");
  assert.equal(res.room.pendingHypnosis?.[0].status, "pending");
  assert.equal(t.charmedDone, true);
  assert.equal(me.roleUses, 1);
  assert.equal(t.roleHealPending, 1);
});

test("慈善家赠予：成立后挂起待处理基因选择，由被赠予者自选（不自动转最高）", () => {
  const phil = makePlayer({ id: "p", roleId: "philanthropist", force: 1, inventory: ["pill"], submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", roleSkill: { type: "gift", giveItemId: "pill", targetPlayerIds: ["t"] }, submittedAt: "" } });
  const target = makePlayer({ id: "t", roleId: "carrier", force: 6, speed: 2, load: 2, submittedAction: { round: 1, fromRoom: null, toRoom: "B302", gasVoteFloor: "B1", submittedAt: "" } });
  const r = buildResolutionPreview(makeRoom([phil, target], 1));
  const pt = r.nextRoom.players.find((p) => p.id === "t")!;
  const pp = r.nextRoom.players.find((p) => p.id === "p")!;
  assert.equal(pt.force, 6);                 // 基因尚未转移（等待对方选择）
  assert.equal(pp.force, 1);
  assert.equal(pt.giftedDone, true);
  assert.equal(pt.pendingGiftFrom, "p");     // 挂起待选
  assert.ok(pt.inventory.includes("pill"));  // 收到赠予道具
  const itemStep = r.steps.find((s) => s.type === "itemStatus")!;
  assert.ok(itemStep.logs.some((m) => /慈善家向【病毒携带者】赠予了 1 张道具/.test(m)), "公开日志应显示赠予双方角色名但不显示位置");
});

test("被赠予者选择转出基因：所选 -1，慈善家 +1；不能选 0 基因；速度不能降到 0", () => {
  const phil = makePlayer({ id: "p", roleId: "philanthropist", force: 2, speed: 3, load: 0 });
  const target = makePlayer({ id: "t", force: 0, speed: 1, load: 5, pendingGiftFrom: "p" });
  const room = makeRoom([phil, target], 1);
  assert.throws(() => chooseGiftGene(room, "t", "force"), /数值为 0/); // force=0 不可选
  assert.throws(() => chooseGiftGene(room, "t", "speed"), /速度/);     // speed=1 转出会归 0
  const after = chooseGiftGene(room, "t", "load");
  assert.equal(after.players.find((p) => p.id === "t")!.load, 4); // 被赠予者 load -1
  assert.equal(after.players.find((p) => p.id === "p")!.load, 1); // 慈善家 load +1
  assert.equal(after.players.find((p) => p.id === "t")!.pendingGiftFrom, null);
});

test("饮品师：果汁不占负重，开局得 B601 两张果汁", () => {
  const b = makePlayer({ id: "b", roleId: "bartender", name: "饮品师", load: 1, inventory: ["juice", "juice", "water"] });
  assert.equal(getInventoryWeight(b), 1); // 仅水占重
  const room = makeRoom([makePlayer({ id: "b2", roleId: "bartender", name: "饮品师" })], 1);
  room.roomInventories = { B601: { juice: 6 } };
  const { room: r2 } = applyRoleSetup(room);
  assert.equal(r2.players[0].inventory.filter((i) => i === "juice").length, 2);
  assert.equal(r2.roomInventories.B601.juice, 4);
});

test("旧存档兼容：饮品师持有 wine 仍计为果汁不占负重", () => {
  const b = makePlayer({ id: "b", roleId: "bartender", load: 1, inventory: ["wine", "water"] });
  assert.equal(getInventoryWeight(b), 1); // wine 归一化为 juice，饮品师不占重
});

test("饮品师多瓶果汁分配多个目标（各自骰面）", () => {
  const b = makePlayer({
    id: "b", roleId: "bartender", inventory: ["juice", "juice"],
    submittedAction: {
      round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", useItems: ["juice", "juice"],
      roleSkill: { type: "juice", juiceAssignments: [{ targetPlayerId: "t1", diceFaces: [6] }, { targetPlayerId: "t2", diceFaces: [3] }] },
      submittedAt: "",
    },
  });
  const t1 = makePlayer({ id: "t1", hp: 5, force: 2, submittedAction: { round: 1, fromRoom: null, toRoom: "B302", gasVoteFloor: "B1", submittedAt: "" } });
  const t2 = makePlayer({ id: "t2", hp: 5, force: 2, submittedAction: { round: 1, fromRoom: null, toRoom: "B305", gasVoteFloor: "B1", submittedAt: "" } });
  const r = buildResolutionPreview(makeRoom([b, t1, t2], 1));
  assert.equal(r.nextRoom.players.find((p) => p.id === "t1")!.hp, 7); // 骰面 6 → +2
  assert.equal(r.nextRoom.players.find((p) => p.id === "t2")!.force, 3); // 骰面 3 → 武力 +1
});

test("饮品师一次使用多瓶果汁时不能把多瓶分配给同一目标", () => {
  const b = makePlayer({ id: "b", roleId: "bartender", inventory: ["juice", "juice"] });
  const t = makePlayer({ id: "t" });
  const room = makeRoom([b, t], 1);
  assert.throws(
    () => chooseResolutionResources(room, "b", {
      useItems: ["juice", "juice"],
      roleSkill: { type: "juice", juiceAssignments: [{ targetPlayerId: "t", diceFaces: [6] }, { targetPlayerId: "t", diceFaces: [3] }] },
    }),
    /同一目标/
  );
});

test("黑客关闭房间 → 该房间基因库本轮失效", () => {
  const hacker = makePlayer({ id: "h", roleId: "hacker", submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", roleSkill: { type: "hacker_close", targetRoom: "201" }, submittedAt: "" } });
  const gene = makePlayer({ id: "g", force: 1, speed: 1, load: 1, submittedAction: { round: 1, fromRoom: null, toRoom: "201", gasVoteFloor: "B1", roomAction: "gene", submittedAt: "" } });
  // 先让黑客技能落地（模拟 submit 时 applyDeclaredSkill），再结算
  const after = applyDeclaredSkill(makeRoom([hacker, gene], 1), "h").room;
  assert.ok(after.closedRooms.includes("201"));
  const r = buildResolutionPreview(after);
  const pg = r.nextRoom.players.find((p) => p.id === "g")!;
  assert.equal(pg.force, 1); // 基因库被关闭，未 +1
});

test("黑客远程基因库三项 +1 且整局限 1 次", () => {
  const hacker = makePlayer({ id: "h", roleId: "hacker", force: 2, speed: 2, load: 2, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", roleSkill: { type: "hacker_func", funcChoice: "gene" }, submittedAt: "" } });
  const after = applyDeclaredSkill(makeRoom([hacker], 1), "h").room;
  const ph = after.players.find((p) => p.id === "h")!;
  assert.equal(ph.force, 3); assert.equal(ph.speed, 3); assert.equal(ph.load, 3);
  assert.ok((ph.roleActionsUsed ?? []).includes("gene"));
  // 再次使用 gene 应抛错
  ph.submittedAction = { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", roleSkill: { type: "hacker_func", funcChoice: "gene" }, submittedAt: "" };
  assert.throws(() => applyDeclaredSkill(makeRoom([ph], 1), "h"));
});

test("驯兽师猎犬：5 步内有库存房间抽 1 张，消耗次数", () => {
  const bm = makePlayer({ id: "bm", roleId: "beastmaster", location: "B103", load: 5, submittedAction: { round: 1, fromRoom: null, toRoom: "B102", gasVoteFloor: "B1", roleSkill: { type: "hound", targetRoom: "B107" }, submittedAt: "" } });
  const room = makeRoom([bm], 1);
  room.roomInventories = { B107: { knife: 5 } };
  const res = applyDeclaredSkill(room, "bm");
  const p = res.room.players.find((x) => x.id === "bm")!;
  assert.equal(p.inventory.length, 1);
  assert.equal(p.inventory[0], "knife");
  assert.equal(p.roleUses, 1);
  assert.equal(res.room.roomInventories.B107.knife, 4);
});

test("驯兽师猎犬：超出 5 步报错", () => {
  const bm = makePlayer({ id: "bm", roleId: "beastmaster", location: "B603", submittedAction: { round: 1, fromRoom: null, toRoom: "B602", gasVoteFloor: "B1", roleSkill: { type: "hound", targetRoom: "201" }, submittedAt: "" } });
  const room = makeRoom([bm], 1);
  room.roomInventories = { "201": { gold: 1 } };
  assert.throws(() => applyDeclaredSkill(room, "bm"));
});

// ---------- v1.0 交易 ----------
console.log("交易系统：");

function freeRoom(players: Player[]): GameRoom {
  const r = makeRoom(players, 1);
  r.status = "FREE";
  r.currentPhase = "FREE";
  return r;
}

test("接受交易后道具转移，并对超重方给出提示", () => {
  const a = makePlayer({ id: "a", name: "A", load: 5, inventory: ["pill", "wine"] });
  const b = makePlayer({ id: "b", name: "B", load: 1, inventory: [] });
  let room = createTrade(freeRoom([a, b]), "a", { toPlayerId: "b", offerItems: ["pill"] });
  const tradeId = room.trades[0].id;
  room = respondTrade(room, tradeId, true);
  const pa = room.players.find((p) => p.id === "a")!;
  const pb = room.players.find((p) => p.id === "b")!;
  assert.ok(!pa.inventory.includes("pill"));
  assert.ok(pb.inventory.includes("pill"));
  assert.equal(room.trades[0].status, "accepted");
});

test("拒绝交易不转移物品", () => {
  const a = makePlayer({ id: "a", name: "A", inventory: ["pill"] });
  const b = makePlayer({ id: "b", name: "B", inventory: [] });
  let room = createTrade(freeRoom([a, b]), "a", { toPlayerId: "b", offerItems: ["pill"] });
  room = respondTrade(room, room.trades[0].id, false);
  assert.equal(room.players.find((p) => p.id === "a")!.inventory.length, 1);
  assert.equal(room.trades[0].status, "rejected");
});

test("非自由阶段不能交易", () => {
  const a = makePlayer({ id: "a", name: "A", inventory: ["pill"] });
  const b = makePlayer({ id: "b", name: "B" });
  assert.throws(() => createTrade(makeRoom([a, b], 1), "a", { toPlayerId: "b", offerItems: ["pill"] }));
});

test("顺位卡交换", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1 });
  const b = makePlayer({ id: "b", name: "B", orderCard: 5 });
  let room = createTrade(freeRoom([a, b]), "a", { toPlayerId: "b", offerOrderCard: true, requestOrderCard: true });
  room = respondTrade(room, room.trades[0].id, true);
  assert.equal(room.players.find((p) => p.id === "a")!.orderCard, 5);
  assert.equal(room.players.find((p) => p.id === "b")!.orderCard, 1);
});

// ---------- v1.0 终局排名 ----------
console.log("终局排名：");

test("金条兑换生命不超过上限", () => {
  const a = makePlayer({ id: "a", hp: 7, inventory: ["gold", "gold"] });
  const b = makePlayer({ id: "b", hp: 9, inventory: ["gold", "gold", "gold"] });
  const { players } = applyFinalGoldConversion([a, b]);
  assert.equal(players.find((p) => p.id === "a")!.hp, 9);
  assert.equal(players.find((p) => p.id === "b")!.hp, 10); // 封顶
});

test("排名：存活优先 → 生命 → 武力；金魔方积分 9..1", () => {
  const ps = [
    makePlayer({ id: "a", name: "A", hp: 8, force: 3, status: "alive" }),
    makePlayer({ id: "b", name: "B", hp: 8, force: 5, status: "alive" }),
    makePlayer({ id: "c", name: "C", hp: 0, force: 9, status: "shadow" }),
  ];
  const rank = computeRanking(makeRoom(ps, 6));
  const byId = Object.fromEntries(rank.map((r) => [r.playerId, r]));
  assert.equal(byId.b.rank, 1); // 生命同 8，武力高者(B)靠前
  assert.equal(byId.a.rank, 2);
  assert.equal(byId.c.rank, 3); // 暗影垫底
  assert.equal(byId.b.points, 3); // 3 人局：第 1 名 = 人数 3
});

test("全员暗影按生前上一轮生命排名", () => {
  const ps = [
    makePlayer({ id: "a", name: "A", status: "shadow", lastRoundHp: 2, force: 9 }),
    makePlayer({ id: "b", name: "B", status: "shadow", lastRoundHp: 5, force: 1 }),
  ];
  const rank = computeRanking(makeRoom(ps, 6));
  assert.equal(rank.find((r) => r.playerId === "b")!.rank, 1);
});

// ---------- v1.0.1 规则漏洞修复 ----------
console.log("v1.0.1 角色撞车抽取：");

function withPrefs(prefs: Record<string, string | null>): Player[] {
  return Object.entries(prefs).map(([id, pref], i) =>
    makePlayer({ id, name: id, seatIndex: i, preferredRoleId: pref })
  );
}

test("全不同：各自获得所选角色", () => {
  const players = withPrefs({ a: "r1", b: "r2", c: "r3" });
  const out = resolveRoleAssignments(players, ["r1", "r2", "r3", "r4"]);
  assert.equal(out.a, "r1");
  assert.equal(out.b, "r2");
  assert.equal(out.c, "r3");
});

test("2 人撞同一角色：从剩余角色无放回抽取，结果唯一", () => {
  const players = withPrefs({ a: "r1", b: "r1", c: "r2" });
  const out = resolveRoleAssignments(players, ["r1", "r2", "r3"]);
  assert.equal(out.c, "r2"); // 唯一选择者锁定
  const vals = [out.a, out.b];
  assert.ok(vals.every((v) => ["r1", "r3"].includes(v))); // 撞车者从剩余 {r1,r3} 取
  assert.notEqual(out.a, out.b); // 唯一
});

test("多组撞车合并为同一池统一抽取，全部唯一", () => {
  const players = withPrefs({ a: "r1", b: "r1", c: "r2", d: "r2" });
  const out = resolveRoleAssignments(players, ["r1", "r2", "r3", "r4"]);
  const vals = [out.a, out.b, out.c, out.d];
  assert.equal(new Set(vals).size, 4); // 4 人 4 个不同角色
  vals.forEach((v) => assert.ok(["r1", "r2", "r3", "r4"].includes(v)));
});

test("9 人全撞同一角色：从剩余池抽取，人人唯一", () => {
  const prefs: Record<string, string> = {};
  for (let i = 0; i < 9; i++) prefs[`p${i}`] = "r1";
  const pool = Array.from({ length: 14 }, (_, i) => `r${i + 1}`);
  const out = resolveRoleAssignments(withPrefs(prefs), pool);
  const vals = Object.values(out);
  assert.equal(vals.length, 9);
  assert.equal(new Set(vals).size, 9);
});

test("角色池>9 时撞车者从剩余角色抽取", () => {
  const players = withPrefs({ a: "r1", b: "r2", c: "r2" }); // b、c 撞
  const out = resolveRoleAssignments(players, ["r1", "r2", "r3", "r4", "r5"]);
  assert.equal(out.a, "r1");
  assert.notEqual(out.b, out.c);
  assert.ok([out.b, out.c].every((v) => v && v !== "r1"));
});

console.log("v1.0.1 顺位锁 / 行动 / 抽卡 / 激光：");

function actionRoom(players: Player[], round = 1): GameRoom {
  const r = makeRoom(players, round);
  r.status = "ACTION";
  r.currentPhase = "ACTION";
  return r;
}

test("currentTurnPlayerId 取顺位最小的未结束存活玩家", () => {
  const a = makePlayer({ id: "a", orderCard: 2, location: "B103" });
  const b = makePlayer({ id: "b", orderCard: 1, location: "B103" });
  assert.equal(currentTurnPlayerId(actionRoom([a, b])), "b");
});

test("非当前顺位玩家提交行动被拒，当前玩家可提交", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1, location: "B103" });
  const b = makePlayer({ id: "b", name: "B", orderCard: 2, location: "B103" });
  const room = actionRoom([a, b]);
  assert.throws(() => submitAction(room, "b", { toRoom: "B102", gasVoteFloor: "B1" }), /还没轮到/);
  const after = submitAction(room, "a", { toRoom: "B102", gasVoteFloor: "B1" });
  assert.ok(after.players.find((p) => p.id === "a")!.submittedAction);
});

test("结束行动后顺位推进到下一玩家，且不能再改", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1, location: "B103" });
  const b = makePlayer({ id: "b", name: "B", orderCard: 2, location: "B103" });
  let room = actionRoom([a, b]);
  room = submitAction(room, "a", { toRoom: "B102", gasVoteFloor: "B1" });
  room = endTurn(room, "a");
  assert.equal(currentTurnPlayerId(room), "b"); // 轮到 b
  assert.throws(() => submitAction(room, "a", { toRoom: "B104", gasVoteFloor: "B1" }), /已结束|已提交/);
});

test("每次行动只能抽一次卡，第二次抛错", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1, location: "B106", load: 9 });
  let room = actionRoom([a]);
  room.roomInventories = { B107: { knife: 5, pistol: 2 } };
  room = submitAction(room, "a", { toRoom: "B107", gasVoteFloor: "B1" });
  room = drawItemsFromRoom(room, "B107", "a", 2);
  const pa = room.players.find((p) => p.id === "a")!;
  assert.equal(pa.submittedAction!.hasDrawnFromRoom, true);
  assert.ok((pa.submittedAction!.privateDrawResult ?? []).length > 0);
  assert.throws(() => drawItemsFromRoom(room, "B107", "a", 2), /只能抽一次|已抽/);
});

test("抽卡日志为私密（不进公共日志）", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1, location: "B106", load: 9 });
  let room = actionRoom([a]);
  room.roomInventories = { B107: { knife: 5 } };
  room = submitAction(room, "a", { toRoom: "B107", gasVoteFloor: "B1" });
  room = drawItemsFromRoom(room, "B107", "a", 1);
  const pub = room.publicLogs.filter((l) => l.visibility === "public");
  assert.ok(!pub.some((l) => /抽到|抽取/.test(l.message)), "公共日志不应含抽卡内容");
  assert.ok(room.publicLogs.some((l) => l.visibility === "private" && l.playerId === "a"));
});

test("激光伤害延迟到结算：提交时不扣血，结算房间效果才 -1", () => {
  // B103→102 相邻，路径含 102（激光室）
  const a = makePlayer({ id: "a", name: "A", orderCard: 1, location: "B103", hp: 10 });
  let room = actionRoom([a]);
  room = submitAction(room, "a", { toRoom: "102", gasVoteFloor: "B1" });
  assert.equal(room.players.find((p) => p.id === "a")!.hp, 10, "提交后不立即扣血");
  const prev = buildResolutionPreview(room);
  assert.equal(prev.nextRoom.players[0].hp, 9, "结算后 -1");
  const roomStep = prev.steps.find((s) => s.type === "roomEffects")!;
  // v1.0.3 §4.3：激光属位置敏感信息——只在裁判/私密日志，不进公开日志。
  assert.ok(!roomStep.logs.some((m) => /激光/.test(m)), "公开日志不含激光位置");
  assert.ok((roomStep.hostLogs ?? []).some((m) => /激光/.test(m)), "裁判日志含激光");
});

test("暗影经过激光室不受伤害", () => {
  const s = makePlayer({ id: "s", status: "shadow", location: "B103", hp: 0, submittedAction: { round: 1, fromRoom: "B103", toRoom: "102", path: ["B103", "102"], gasVoteFloor: null, submittedAt: "" } });
  const prev = buildResolutionPreview(makeRoom([s], 1));
  assert.equal(prev.nextRoom.players[0].hp, 0);
});

console.log("v1.0.1 侦探 / 催眠：");

test("侦探跟踪已结束行动的前序玩家，移动到其终点房间", () => {
  const target = makePlayer({ id: "t", name: "T", orderCard: 1, location: "B103", endedAction: true, submittedAction: { round: 1, fromRoom: "B103", toRoom: "B107", path: ["B103", "B107"], gasVoteFloor: "B1", submittedAt: "" } });
  const det = makePlayer({ id: "d", name: "D", roleId: "detective", orderCard: 2, location: "B102", roleUses: 0 });
  let room = actionRoom([target, det]);
  room.roomInventories = { B107: {} };
  room = submitAction(room, "d", { toRoom: "B102", gasVoteFloor: "B1", roleSkill: { type: "track", targetPlayerIds: ["t"] } });
  const pd = room.players.find((p) => p.id === "d")!;
  assert.equal(pd.submittedAction!.toRoom, "B107"); // 跟随到目标终点
  assert.equal(pd.roleUses, 1);
  assert.equal(room.players.find((p) => p.id === "t")!.trackedDone, true);
});

test("催眠 5 步不可达时抛错（强制移动失败）", () => {
  // B603（B6）到 201（2F）远超 5 步
  const hyp = makePlayer({ id: "h", name: "H", roleId: "hypnotist", location: "B603", submittedAction: { round: 1, fromRoom: "B603", toRoom: "B602", gasVoteFloor: "B1", roleSkill: { type: "charm", targetPlayerIds: ["v"], targetRoom: "201" }, submittedAt: "" } });
  const v = makePlayer({ id: "v", name: "V", location: "B603" });
  assert.throws(() => applyDeclaredSkill(makeRoom([hyp, v], 1), "h"), /5 步|到达/);
});

console.log("地图编辑器草稿数据 / 校验 / 寻路：");

test("默认布局覆盖全部规则房间且无未知房间", () => {
  const issues = validateMapData(DEFAULT_MAP_LAYOUT, DEFAULT_MAP_CONNECTIONS);
  const errors = issues.filter((i) => i.level === "error");
  assert.equal(errors.length, 0, errors.map((e) => e.message).join("；"));
});

test("默认连接无孤立房间", () => {
  const issues = validateMapData(DEFAULT_MAP_LAYOUT, DEFAULT_MAP_CONNECTIONS);
  const isolated = issues.filter((i) => i.message.startsWith("孤立房间"));
  assert.equal(isolated.length, 0, isolated.map((e) => e.message).join("；"));
});

test("连接图最短路径：B103 → B107 经廊桥 4 步（与 mapGraph 图结构一致）", () => {
  const r = shortestPath(DEFAULT_MAP_CONNECTIONS, "B103", "B107");
  assert.ok(r, "应可达");
  assert.equal(r!.steps, 4); // B103→B104→B105→B106(廊桥)→B107
  assert.ok(r!.edgeTypes.includes("bridge"));
});

test("校验能检测重复连接", () => {
  const dup = [
    { id: "a", from: "101", to: "102", type: "adjacent" as const, bidirectional: true },
    { id: "b", from: "102", to: "101", type: "adjacent" as const, bidirectional: true },
  ];
  const issues = validateMapData(DEFAULT_MAP_LAYOUT, dup);
  assert.ok(issues.some((i) => i.message.startsWith("重复连接")));
});

test("makeConnectionId 双向与端点顺序无关、单向保留方向", () => {
  assert.equal(makeConnectionId("B105", "B103", "adjacent", true), makeConnectionId("B103", "B105", "adjacent", true));
  assert.notEqual(makeConnectionId("B105", "B503", "pipe", false), makeConnectionId("B503", "B105", "pipe", false));
});

// ---------- v1.0.2 修复 ----------
console.log("v1.0.2 顺位卡交易唯一性：");

test("顺位卡交易统一为交换：A↔B、B↔C 后三人仍各 1 张且唯一", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1 });
  const b = makePlayer({ id: "b", name: "B", orderCard: 2 });
  const c = makePlayer({ id: "c", name: "C", orderCard: 3 });
  let room = freeRoom([a, b, c]);
  // 只勾「给出顺位卡」，引擎应自动视为双方交换
  room = createTrade(room, "a", { toPlayerId: "b", offerOrderCard: true });
  room = respondTrade(room, room.trades[room.trades.length - 1].id, true);
  room = createTrade(room, "b", { toPlayerId: "c", offerOrderCard: true });
  room = respondTrade(room, room.trades[room.trades.length - 1].id, true);
  const cards = room.players.map((p) => p.orderCard).sort();
  assert.deepEqual(cards, [1, 2, 3]); // 集合不变：无重复、无丢失
  assert.equal(validateTurnOrderCards(room).ok, true);
});

test("validateTurnOrderCards 检出重复 / 缺失", () => {
  const dup = makeRoom([makePlayer({ id: "a", name: "A", orderCard: 1 }), makePlayer({ id: "b", name: "B", orderCard: 1 })], 1);
  assert.equal(validateTurnOrderCards(dup).ok, false);
  const missing = makeRoom([makePlayer({ id: "a", name: "A", orderCard: null })], 1);
  assert.equal(validateTurnOrderCards(missing).ok, false);
});

test("行动阶段不能再处理交易（顺位卡冻结）", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1 });
  const b = makePlayer({ id: "b", name: "B", orderCard: 2 });
  let room = createTrade(freeRoom([a, b]), "a", { toPlayerId: "b", offerOrderCard: true });
  const tid = room.trades[0].id;
  room = { ...room, currentPhase: "ACTION", status: "ACTION" };
  assert.throws(() => respondTrade(room, tid, true), /自由阶段/);
});

console.log("v1.0.2 轮次表达：");

test("formatRoundLabel：0→首轮出生战斗，1→第1轮，6→第6轮", () => {
  assert.equal(formatRoundLabel(0), "首轮出生战斗");
  assert.equal(formatRoundLabel(1), "第 1 轮");
  assert.equal(formatRoundLabel(6), "第 6 轮");
});

test("正式第1轮毒气 -1；第2轮毒气 -2", () => {
  const mk = (round: number) => {
    const p = makePlayer({ id: "p", inventory: ["water", "food"], submittedAction: { round, fromRoom: null, toRoom: "B302", gasVoteFloor: "B3", submitWater: true, submitFood: true, submittedAt: "" } });
    return buildResolutionPreview(makeRoom([p], round, ["B3"]));
  };
  assert.equal(mk(1).nextRoom.players[0].hp, 9);
  assert.equal(mk(2).nextRoom.players[0].hp, 8);
});

console.log("v1.0.2 毒气公开不显示票数：");

test("毒气公开日志只显示楼层，票数仅房主裁判可见", () => {
  const ps = [
    at("a", "103", { gasVoteFloor: "B3" }), at("b", "103", { gasVoteFloor: "B3" }),
    at("c", "103", { gasVoteFloor: "B5" }),
  ];
  const prev = buildResolutionPreview(makeRoom(ps, 2));
  const gas = prev.steps.find((s) => s.type === "gas")!;
  assert.ok(gas.logs.some((m) => /毒气楼层/.test(m)), "公开应含毒气楼层");
  assert.ok(!gas.logs.some((m) => /计票|票/.test(m)), "公开不应含票数");
  assert.ok((gas.hostLogs ?? []).some((m) => /计票/.test(m)), "票数应在房主裁判日志");
});

console.log("v1.0.2 强制抽卡确认：");

test("可抽卡房间未抽未放弃不能结束行动；放弃后可结束", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1, location: "B106", load: 9 });
  let room = actionRoom([a]);
  room.roomInventories = { B107: { knife: 5 } };
  room = submitAction(room, "a", { toRoom: "B107", gasVoteFloor: "B1" });
  assert.throws(() => endTurn(room, "a"), /抽卡/);
  room = skipDraw(room, "a");
  room = endTurn(room, "a");
  assert.equal(room.players.find((p) => p.id === "a")!.endedAction, true);
});

test("抽卡后可直接结束行动", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1, location: "B106", load: 9 });
  let room = actionRoom([a]);
  room.roomInventories = { B107: { knife: 5 } };
  room = submitAction(room, "a", { toRoom: "B107", gasVoteFloor: "B1" });
  room = drawItemsFromRoom(room, "B107", "a", 2);
  room = endTurn(room, "a");
  assert.equal(room.players.find((p) => p.id === "a")!.endedAction, true);
});

console.log("v1.0.2 本地热座随机生成：");

test("fillTestPlayers 生成 9 名玩家、角色唯一、可开始", () => {
  const room = createGame({ hostName: "房主", devMode: false });
  const filled = fillTestPlayers(room);
  const seated = filled.players.filter((p) => p.name);
  assert.equal(seated.length, 9);
  assert.equal(new Set(seated.map((p) => p.preferredRoleId)).size, 9); // 角色唯一
  assert.ok(seated.every((p) => !!p.location && isGeneValid({ force: p.force, speed: p.speed, load: p.load })));
  assert.ok(seated.every((p) => p.force >= 1 && p.speed >= 1 && p.load >= 1 && Math.max(p.force, p.speed, p.load) <= 7));
  assert.equal(canStartGame(filled).ok, true);
});

console.log("v1.0.2 果汁目标 / 三层日志：");

test("普通玩家果汁对自己使用并消耗（目标=自己，掷面6 +2）", () => {
  // 普通玩家也可逐瓶指定目标/骰面（UI 默认对自己）；此处指定骰面 6 保证确定性。
  const p = makePlayer({ id: "p", hp: 5, inventory: ["juice"], submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", useItems: ["juice"], roleSkill: { type: "juice", juiceAssignments: [{ targetPlayerId: "p", diceFaces: [6] }] }, submittedAt: "" } });
  const r = buildResolutionPreview(makeRoom([p], 1));
  assert.equal(r.nextRoom.consumedPile.juice, 1); // 果汁被消耗
  assert.equal(r.nextRoom.players[0].hp, 7); // 对自己掷出 6 → 生命 +2
});

test("黑客锁房间：进入者私密提示，公开日志不暴露被锁房间", () => {
  const hacker = makePlayer({ id: "h", name: "H", roleId: "hacker", submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", roleSkill: { type: "hacker_close", targetRoom: "201" }, submittedAt: "" } });
  const g = makePlayer({ id: "g", name: "G", force: 1, speed: 1, load: 1, submittedAction: { round: 1, fromRoom: null, toRoom: "201", gasVoteFloor: "B1", roomAction: "gene", submittedAt: "" } });
  const after = applyDeclaredSkill(makeRoom([hacker, g], 1), "h").room;
  const prev = buildResolutionPreview(after);
  const rs = prev.steps.find((s) => s.type === "roomEffects")!;
  assert.ok((rs.privateLogs ?? []).some((pl) => pl.playerId === "g" && /功能被关闭/.test(pl.text)), "进入者应收到私密提示");
  assert.ok(!rs.logs.some((m) => /201|关闭/.test(m)), "公开日志不应暴露被锁房间");
});

// ---------- v1.0.3 修复 ----------
console.log("v1.0.3 属性校验：");

test("初始属性：速度不能为 0；和不能超过 10；和需恰为 10", () => {
  assert.equal(validateInitialGenes({ force: 5, speed: 0, load: 5 }).ok, false); // 速度 0
  assert.equal(validateInitialGenes({ force: 5, speed: 4, load: 5 }).ok, false); // 和 14 >10
  assert.equal(validateInitialGenes({ force: 4, speed: 3, load: 2 }).ok, false); // 和 9 ≠10
  assert.equal(validateInitialGenes({ force: 4, speed: 4, load: 2 }).ok, true);
  assert.equal(isGeneValid({ force: 5, speed: 0, load: 5 }), false); // isGeneValid 也要求速度≥1
});

test("操作室重分配基因：速度不能为 0", () => {
  const h = makePlayer({ id: "h", roleId: "hacker", force: 5, speed: 1, load: 4, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", roleSkill: { type: "hacker_func", funcChoice: "operate", genes: { force: 6, speed: 0, load: 4 } }, submittedAt: "" } });
  assert.throws(() => applyDeclaredSkill(makeRoom([h], 1), "h"), /速度/);
});

test("B304 操作室：停留玩家可重分配当前基因总和，速度不能为 0", () => {
  const p = makePlayer({ id: "p", force: 6, speed: 2, load: 3, location: "B303", submittedAction: { round: 1, fromRoom: "B303", toRoom: "B304", gasVoteFloor: "B1", submittedAt: "" } });
  let room = makeRoom([p], 1);
  room.currentPhase = "ACTION";
  room.status = "ACTION";
  assert.throws(() => reallocateGenesAtOperationRoom(room, "p", { force: 7, speed: 0, load: 4 }), /速度/);
  room = reallocateGenesAtOperationRoom(room, "p", { force: 5, speed: 3, load: 3 });
  const next = room.players[0];
  assert.equal(next.force, 5);
  assert.equal(next.speed, 3);
  assert.equal(next.load, 3);
});

test("负重 0 无次元口袋时不能获得次元口袋（canGainItem）", () => {
  const poor = makePlayer({ id: "a", load: 0, inventory: [] });
  assert.equal(canGainItem(poor, "pocket").ok, false);
  assert.equal(canGainItem(poor, "knife").ok, true); // 其他道具不受此限（超重另行处理）
  const withPocket = makePlayer({ id: "b", load: 0, inventory: ["pocket"] });
  assert.equal(canGainItem(withPocket, "pocket").ok, true); // 已持有则无悖论
});

test("负重 0 玩家抽到次元口袋会被退回房间库存，不被持有", () => {
  // 直接构造已提交在 B503 的行动，避免移动校验干扰本用例。
  const a = makePlayer({ id: "a", name: "A", orderCard: 1, location: "B503", load: 0, submittedAction: { round: 1, fromRoom: null, toRoom: "B503", gasVoteFloor: "B1", submittedAt: "" } });
  let room = actionRoom([a]);
  room.roomInventories = { B503: { pocket: 1 } };
  room = drawItemsFromRoom(room, "B503", "a", 5);
  const pa = room.players.find((p) => p.id === "a")!;
  assert.ok(!pa.inventory.includes("pocket"), "负重 0 不应持有次元口袋");
  assert.equal((room.roomInventories.B503 ?? {}).pocket, 1, "次元口袋退回库存");
});

console.log("v1.0.3 房间关闭统一拦截：");

test("isRoomFunctionAvailable：关闭房间返回 false", () => {
  const room = { ...makeRoom([makePlayer({ id: "a" })], 1), closedRooms: ["B204"] };
  assert.equal(isRoomFunctionAvailable("B204", room), false);
  assert.equal(isRoomFunctionAvailable("B202", room), true);
});

console.log("v1.0.6 黑客关闭房间时点：");

test("黑客关闭即时房间只影响黑客之后进入/使用的人", () => {
  const early = makePlayer({ id: "early", orderCard: 1, submittedAction: { round: 1, fromRoom: null, toRoom: "201", gasVoteFloor: "B1", roomAction: "gene", submittedAt: "" } });
  const hacker = makePlayer({ id: "h", roleId: "hacker", orderCard: 2, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", roleSkill: { type: "hacker_close", targetRoom: "201" }, submittedAt: "" } });
  const late = makePlayer({ id: "late", orderCard: 3, submittedAction: { round: 1, fromRoom: null, toRoom: "201", gasVoteFloor: "B1", roomAction: "gene", submittedAt: "" } });
  const room = applyDeclaredSkill(makeRoom([early, hacker, late], 1), "h").room;
  assert.equal(isRoomFunctionDisabledForAction("201", room, early), false);
  assert.equal(isRoomFunctionDisabledForAction("201", room, late), true);
  const r = buildResolutionPreview(room);
  assert.equal(r.nextRoom.players.find((p) => p.id === "early")!.force, 1);
  assert.equal(r.nextRoom.players.find((p) => p.id === "late")!.force, 0);
});

test("黑客关闭抽卡房间不回溯取消先行动者抽卡，但阻止后行动者抽卡", () => {
  const early = makePlayer({ id: "early", orderCard: 1, location: "B106", load: 5, submittedAction: { round: 1, fromRoom: "B106", toRoom: "B107", gasVoteFloor: "B1", submittedAt: "" } });
  const hacker = makePlayer({ id: "h", roleId: "hacker", orderCard: 2, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", roleSkill: { type: "hacker_close", targetRoom: "B107" }, submittedAt: "" } });
  const late = makePlayer({ id: "late", orderCard: 3, location: "B106", load: 5, submittedAction: { round: 1, fromRoom: "B106", toRoom: "B107", gasVoteFloor: "B1", submittedAt: "" } });
  let room = actionRoom([early, hacker, late]);
  room.roomInventories = { B107: { knife: 2 } };
  room = applyDeclaredSkill(room, "h").room;
  room = drawItemsFromRoom(room, "B107", "early", 1);
  assert.equal(room.players.find((p) => p.id === "early")!.inventory.length, 1);
  assert.throws(() => drawItemsFromRoom(room, "B107", "late", 1), /关闭/);
});

test("黑客关闭结算房间时，餐厅和手术室在结算统一失效", () => {
  const room = { ...makeRoom([makePlayer({ id: "a" })], 2), closedRooms: ["B204"], closedRoomRecords: [{ roomId: "B204", round: 2, closedByPlayerId: "h", actionOrder: 9, closedAt: "" }] };
  assert.equal(isRoomFunctionDisabledForResolution("B204", room), true);
  assert.equal(isRoomFunctionDisabledForResolution("B202", room), false);
});

test("餐厅被黑客关闭后仍需上交水粮（不再免除）", () => {
  // 第 2 轮；玩家在餐厅 B204 但餐厅被关闭，未选择上交水粮 → 扣 2。
  const p = makePlayer({ id: "p", hp: 10, submittedAction: { round: 2, fromRoom: null, toRoom: "B204", gasVoteFloor: "B1", submittedAt: "" } });
  const room = { ...makeRoom([p], 2), closedRooms: ["B204"] };
  const r = buildResolutionPreview(room);
  assert.equal(r.nextRoom.players[0].hp, 8); // 餐厅失效 → 水粮 -2
});

test("餐厅未被关闭时免水粮", () => {
  const p = makePlayer({ id: "p", hp: 10, submittedAction: { round: 2, fromRoom: null, toRoom: "B204", gasVoteFloor: "B1", submittedAt: "" } });
  const r = buildResolutionPreview(makeRoom([p], 2));
  assert.equal(r.nextRoom.players[0].hp, 10);
});

test("手术室被黑客关闭后不回血且照常战斗", () => {
  const a = makePlayer({ id: "a", hp: 5, force: 0, submittedAction: { round: 1, fromRoom: null, toRoom: "B202", gasVoteFloor: "B1", submittedAt: "" } });
  const b = makePlayer({ id: "b", hp: 5, force: 3, submittedAction: { round: 1, fromRoom: null, toRoom: "B202", gasVoteFloor: "B1", submittedAt: "" } });
  const room = { ...makeRoom([a, b], 1), closedRooms: ["B202"] };
  const r = buildResolutionPreview(room);
  // 关闭→不手术(+4)，2 人照常战斗：a 扣 3、b 不扣
  assert.equal(r.nextRoom.players.find((p) => p.id === "a")!.hp, 2);
  assert.equal(r.nextRoom.players.find((p) => p.id === "b")!.hp, 5);
});

console.log("v1.0.3 公开日志脱敏：");

test("战斗公开只显示房间，不显示参战者/伤害；明细在裁判日志", () => {
  const a = makePlayer({ id: "a", name: "A", force: 5, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
  const b = makePlayer({ id: "b", name: "B", force: 2, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
  const step = buildResolutionPreview(makeRoom([a, b], 1)).steps.find((s) => s.type === "combat")!;
  assert.ok(step.logs.some((m) => /发生战斗/.test(m)), "公开含发生战斗");
  assert.ok(!step.logs.some((m) => /战力|扣|vs/.test(m)), "公开不含参战者/伤害");
  assert.ok((step.hostLogs ?? []).some((m) => /vs|扣/.test(m)), "裁判含明细");
});

test("火箭筒公开只显示被袭击房间，不显示发射者/伤害", () => {
  const s = makePlayer({ id: "s", name: "S", inventory: ["rocket"], submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", rocketTargetRoom: "B302", submittedAt: "" } });
  const v = makePlayer({ id: "v", name: "V", submittedAction: { round: 1, fromRoom: null, toRoom: "B302", gasVoteFloor: "B1", submittedAt: "" } });
  const step = buildResolutionPreview(makeRoom([s, v], 1)).steps.find((st) => st.type === "rocket")!;
  assert.ok(step.logs.some((m) => /遭到火箭筒袭击/.test(m)));
  assert.ok(!step.logs.some((m) => /扣|发射|用火箭筒/.test(m)));
  assert.ok((step.hostLogs ?? []).some((m) => /用火箭筒袭击/.test(m)));
});

test("结算最后统一公开各玩家最终生命值（finalHp 步骤）", () => {
  const p = makePlayer({ id: "p", name: "P", hp: 7, submittedAction: { round: 1, fromRoom: null, toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
  const steps = buildResolutionPreview(makeRoom([p], 1)).steps;
  const last = steps[steps.length - 1];
  assert.equal(last.type, "finalHp");
  assert.ok(last.logs.some((m) => /7 点生命/.test(m)));
});

console.log("v1.0.4 水粮结算模型 / 毒气投票末尾：");

test("行动阶段不再预交水粮，进入下一轮不会结转 waterPledged/foodPledged", () => {
  const p = makePlayer({ id: "p", name: "P", orderCard: 1, location: "B103", inventory: ["water", "food"] });
  const q = makePlayer({ id: "q", name: "Q", orderCard: 2, location: "B103" });
  let room = actionRoom([p, q], 1);
  room = submitAction(room, "p", { toRoom: "B102", gasVoteFloor: "B1", submitWater: true, submitFood: true });
  room = endTurn(room, "p");
  room = submitAction(room, "q", { toRoom: "B104", gasVoteFloor: "B1" });
  room = endTurn(room, "q");
  // 进入结算并确认 → advanceToNextRound 结转 pledge
  room = goToPhase(room, "RESOLUTION");
  room = chooseResolutionResources(room, "p", { submitWater: false, submitFood: false, useItems: [] });
  room = generateResolutionPreview(room);
  room = confirmResolution(room);
  const np = room.players.find((x) => x.id === "p")!;
  assert.equal(np.waterPledged, false);
  assert.equal(np.foodPledged, false);
  assert.equal(room.currentRound, 2);
});

test("存活玩家未投毒气不能结束行动；投票后可结束", () => {
  const a = makePlayer({ id: "a", name: "A", orderCard: 1, location: "B103" });
  let room = actionRoom([a], 1);
  room = submitAction(room, "a", { toRoom: "B102" }); // 不带毒气投票
  assert.throws(() => endTurn(room, "a"), /毒气投票/);
  room = reviseAction(room, "a", { gasVoteFloor: "B1" });
  room = endTurn(room, "a");
  assert.equal(room.players.find((p) => p.id === "a")!.endedAction, true);
});

console.log("v1.0.3 本地热座单个随机生成：");

test("addRandomTestPlayer 生成 1 名玩家、角色唯一、速度≥1；座位满则报错", () => {
  let room = createGame({ hostName: "房主", devMode: false });
  const before = room.players.filter((p) => p.name).length;
  room = addRandomTestPlayer(room);
  const after = room.players.filter((p) => p.name).length;
  assert.equal(after, before + 1);
  const roles = room.players.filter((p) => p.name).map((p) => p.preferredRoleId);
  assert.equal(new Set(roles).size, roles.length); // 角色唯一
  const newest = room.players.filter((p) => p.name).find((p) => p.preferredRoleId && p.seatIndex === before);
  assert.ok(newest, "生成的玩家存在");
  assert.ok(newest!.force >= 1 && newest!.speed >= 1 && newest!.load >= 1 && Math.max(newest!.force, newest!.speed, newest!.load) <= 7);
  assert.equal(newest!.force + newest!.speed + newest!.load, 10);
  // 填满 9 人后再添加应报错
  while (room.players.some((p) => !p.name)) room = addRandomTestPlayer(room);
  assert.throws(() => addRandomTestPlayer(room), /座位已满/);
});

// ---------- v1.0.4 修复 ----------
console.log("v1.0.5 首轮出生战斗 / 催眠询问 / 结算确认 / 慈善家：");

test("startGame 后进入首轮出生战斗结算，不进入正式第 1 轮自由阶段", () => {
  let room = createGame({ hostName: "房主", devMode: true });
  room = fillTestPlayers(room);
  room = startGame(room);
  assert.equal(room.currentPhase, "SPAWN_COMBAT");
  assert.equal(room.currentRound, 0);
  assert.equal(room.players.some((p) => p.orderCard != null), false, "首轮出生战斗前不抽顺位卡");
  assert.equal(room.airdrops.length, 0, "首轮出生战斗前不生成空投");
});

test("首轮出生战斗只结算出生房间战斗，不触发毒气、水粮、房间效果或火箭筒", () => {
  const a = makePlayer({ id: "a", name: "A", force: 5, location: "103", hp: 10, inventory: ["rocket"] });
  const b = makePlayer({ id: "b", name: "B", force: 2, location: "103", hp: 10 });
  const c = makePlayer({ id: "c", name: "C", force: 1, location: "B303", hp: 10 });
  let room = makeRoom([a, b, c], 0);
  room.currentPhase = "SPAWN_COMBAT";
  room.status = "SPAWN_COMBAT";
  room.gasFloors = ["B3"];
  room.roomInventories = { "201": {}, "B701": {} };
  room = generateResolutionPreview(room);
  const types = room.resolutionPreview!.steps.map((s) => s.type);
  assert.deepEqual(types, ["combat", "deathRevive", "finalHp"]);
  assert.equal(room.resolutionPreview!.nextRoom.players.find((p) => p.id === "b")!.hp, 7);
  assert.equal(room.resolutionPreview!.nextRoom.players.find((p) => p.id === "c")!.hp, 10);
  assert.ok(!room.resolutionPreview!.steps.some((s) => ["gas", "foodWater", "rocket", "roomEffects"].includes(s.type)));
  const publicText = room.resolutionPreview!.steps.find((s) => s.type === "combat")!.logs.join(" ");
  assert.ok(/103.*战斗/.test(publicText), "公开日志应只说明出生房间发生战斗");
  assert.ok(!/A|B|扣/.test(publicText), "首轮战斗公开日志不得泄露参战者或扣血");
});

test("确认首轮出生战斗后进入正式第 1 轮自由阶段并抽顺位卡", () => {
  const a = makePlayer({ id: "a", name: "A", force: 5, location: "103", hp: 10 });
  const b = makePlayer({ id: "b", name: "B", force: 2, location: "B103", hp: 10 });
  let room = makeRoom([a, b], 0);
  room.currentPhase = "SPAWN_COMBAT";
  room.status = "SPAWN_COMBAT";
  room = generateResolutionPreview(room);
  room = confirmResolution(room);
  assert.equal(room.currentPhase, "FREE");
  assert.equal(room.currentRound, 1);
  assert.equal(room.players.filter((p) => p.name && p.status === "alive").every((p) => p.orderCard != null), true);
  assert.equal(room.airdrops.length, 1, "第 1 轮自由阶段才生成第 1 轮空投");
});

test("催眠师行动前确认后创建 pending；目标轮到行动时强制锁定", () => {
  const hyp = makePlayer({ id: "h", roleId: "hypnotist", location: "B102", orderCard: 1 });
  const victim = makePlayer({ id: "v", location: "B103", orderCard: 2 });
  let room = actionRoom([hyp, victim], 1);
  assert.equal(currentTurnPlayerId(room), null, "催眠师未确认前不进入顺位行动");
  room = submitHypnosisDecision(room, "h", { use: true, targetPlayerId: "v", targetRoom: "B102" });
  assert.equal(room.pendingHypnosis?.length, 1);
  assert.equal(room.pendingHypnosis?.[0].status, "pending");
  room = submitAction(room, "h", { toRoom: "B101", gasVoteFloor: "B1" });
  room = { ...room, players: room.players.map((p) => (p.id === "h" ? { ...p, endedAction: true } : p)) };
  assert.throws(() => submitAction(room, "v", { toRoom: "B104", gasVoteFloor: "B1" }), /催眠|必须前往/);
  room = submitAction(room, "v", { toRoom: "B102", gasVoteFloor: "B1" });
  assert.equal(room.players.find((p) => p.id === "v")!.submittedAction!.toRoom, "B102");
  assert.equal(room.pendingHypnosis?.[0].status, "applied");
});

test("催眠师催眠自己时，自己行动也只能执行强制目标", () => {
  const hyp = makePlayer({ id: "h", roleId: "hypnotist", location: "B103", orderCard: 1 });
  let room = actionRoom([hyp], 1);
  room = submitHypnosisDecision(room, "h", { use: true, targetPlayerId: "h", targetRoom: "B102" });
  assert.throws(() => submitAction(room, "h", { toRoom: "B104", gasVoteFloor: "B1" }), /催眠|必须前往/);
  room = submitAction(room, "h", { toRoom: "B102", gasVoteFloor: "B1" });
  assert.equal(room.players[0].submittedAction!.toRoom, "B102");
  assert.equal(room.pendingHypnosis[0].status, "applied");
});

test("行动阶段提交会忽略水粮和药/果汁/肾上腺素，结算阶段资源选择才生效", () => {
  const p = makePlayer({ id: "p", name: "P", orderCard: 1, location: "B103", inventory: ["water", "food", "pill", "adrenaline"] });
  let room = actionRoom([p], 2);
  room = submitAction(room, "p", { toRoom: "B102", gasVoteFloor: "B1", submitWater: true, submitFood: true, useItems: ["pill", "adrenaline"] });
  let a = room.players.find((x) => x.id === "p")!.submittedAction!;
  assert.equal(a.submitWater, undefined);
  assert.equal(a.submitFood, undefined);
  assert.deepEqual(a.useItems, []);

  room = { ...room, currentPhase: "RESOLUTION", status: "RESOLUTION" };
  room = chooseResolutionResources(room, "p", { submitWater: true, submitFood: true, useItems: ["pill", "adrenaline"] });
  a = room.players.find((x) => x.id === "p")!.submittedAction!;
  assert.equal(a.submitWater, true);
  assert.equal(a.submitFood, true);
  assert.deepEqual(a.useItems, ["pill", "adrenaline"]);
  assert.equal(missingSettlementConfirmers(room).length, 0);
});

test("房主应用结算前，持有可结算资源的玩家必须确认", () => {
  const p = makePlayer({
    id: "p",
    name: "P",
    roleId: "mercenary",
    inventory: ["water"],
    submittedAction: { round: 2, fromRoom: "B103", toRoom: "B102", gasVoteFloor: "B3", submittedAt: "" },
  });
  let room = makeRoom([p], 2);
  room = generateResolutionPreview(room);
  assert.throws(() => confirmResolution(room), /未确认结算资源选择/);
  room = chooseResolutionResources({ ...room, resolutionPreview: null }, "p", { submitWater: false, submitFood: false, useItems: [] });
  assert.doesNotThrow(() => assertSettlementConfirmationsReady(room));
});

test("慈善家在结算确认面板只能赠出一张具体道具", () => {
  const charity = makePlayer({
    id: "c",
    name: "C",
    roleId: "philanthropist",
    inventory: ["water", "water", "knife"],
    submittedAction: { round: 1, fromRoom: "103", toRoom: "103", gasVoteFloor: "B1", submittedAt: "" },
  });
  const target = makePlayer({ id: "t", name: "T", roleId: "mercenary", inventory: [] });
  let room = makeRoom([charity, target], 1);
  room = chooseResolutionResources(room, "c", {
    useItems: [],
    roleSkill: { type: "gift", targetPlayerIds: ["t"], giveItemId: "water", giveItemIndex: 1 },
  });
  const sk = room.players.find((p) => p.id === "c")!.submittedAction!.roleSkill!;
  assert.equal(sk.giveItemId, "water");
  assert.equal(sk.giveItemIndex, 1);
  const prev = buildResolutionPreview(room);
  const nextCharity = prev.nextRoom.players.find((p) => p.id === "c")!;
  const nextTarget = prev.nextRoom.players.find((p) => p.id === "t")!;
  assert.deepEqual(nextCharity.inventory, ["water", "knife"]);
  assert.deepEqual(nextTarget.inventory, ["water"]);
});

test("第 2 轮水粮按结算阶段选择当轮上交，不再依赖上一轮预交", () => {
  const p = makePlayer({
    id: "p",
    hp: 5,
    inventory: ["water", "food"],
    submittedAction: { round: 2, fromRoom: "B103", toRoom: "B102", gasVoteFloor: "B3", submitWater: true, submitFood: true, submittedAt: "" },
  });
  const r = buildResolutionPreview(makeRoom([p], 2));
  assert.equal(r.nextRoom.players[0].hp, 5);
  assert.equal(r.nextRoom.players[0].inventory.includes("water"), false);
  assert.equal(r.nextRoom.players[0].inventory.includes("food"), false);
});

test("确认结算落地后，公开日志带有阶段分组标签", () => {
  const a = makePlayer({ id: "a", name: "A", force: 5, submittedAction: { round: 1, fromRoom: "103", toRoom: "103", gasVoteFloor: "B1", submittedAt: "" } });
  const b = makePlayer({ id: "b", name: "B", force: 2, submittedAction: { round: 1, fromRoom: "B103", toRoom: "B103", gasVoteFloor: "B1", submittedAt: "" } });
  let room = makeRoom([a, b], 1);
  room = generateResolutionPreview(room);
  room = confirmResolution(room);
  const phases = new Set(room.publicLogs.filter((l) => l.visibility === "public").map((l) => l.logPhase).filter(Boolean));
  assert.ok(phases.has("resolution_combat"));
  assert.ok(phases.has("resolution_supply"));
  assert.ok(phases.has("final"));
});

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
