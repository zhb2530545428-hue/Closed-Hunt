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
    isReady: true,
    submittedAction: p.submittedAction ?? null,
  };
}

function makeRoom(players: Player[], round = 1, gasFloors: string[] = []): GameRoom {
  return {
    id: "r", roomCode: "TEST", status: "RESOLUTION", currentRound: round, currentPhase: "RESOLUTION",
    hostPlayerId: players[0]?.id ?? "h", players, gasFloors, clearedGasRooms: [],
    roomInventories: {}, consumedPile: {}, airdrops: [], resolutionPreview: null,
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
test("B103 速度 1 可达相邻房间", () => {
  const r = ids("B103", 1);
  for (const x of ["B102", "B104", "B203", "102"]) assert.ok(r.includes(x), `应可达 ${x}`);
  assert.ok(!r.includes("B103"), "不含起点");
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
  const v = validateMove(ctx("B103", 1), "102");
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

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
