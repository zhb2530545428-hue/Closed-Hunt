// 抽卡 / 空投 / 丢弃。来源：规则手册 14.1、14.2、10；开发指令 3.3。
// 抽卡在行动阶段即时进行：从目标房间库存抽取，立即更新房间库存与玩家手牌。

import type { GameRoom, Player } from "../types";
import { appendPrivateLog, nowISO, shuffle } from "./helpers";
import { invAdd, invRemove, invToList, canGainItem } from "../inventory";
import { getDrawLimit, isRoomFunctionAvailable } from "../config/roomFunctions";
import { isJunkItem, getItemName } from "../config/items";
import { getRoomLabel } from "../config/rooms";
import { airdropItemsByRound, displayRound, formatRoundLabel } from "../config/rounds";

/** 把本次抽到的道具写入玩家本轮行动的私密抽卡结果（即时私密展示，§3）。 */
function recordDraw(player: Player, roomId: string, drawn: string[]): Player {
  const a = player.submittedAction;
  if (!a) return player;
  return {
    ...player,
    submittedAction: {
      ...a,
      hasDrawnFromRoom: true,
      drawnRoomId: roomId,
      privateDrawResult: [...(a.privateDrawResult ?? []), ...drawn],
    },
  };
}

function replacePlayer(room: GameRoom, player: Player): GameRoom {
  return {
    ...room,
    players: room.players.map((p) => (p.id === player.id ? player : p)),
    updatedAt: nowISO(),
  };
}

/** 从库存随机抽 n 张（不放回），返回抽出的 id 列表与剩余库存。 */
function drawRandom(inv: GameRoom["roomInventories"][string], n: number) {
  let pool = invToList(inv);
  pool = shuffle(pool);
  const drawn = pool.slice(0, Math.max(0, n));
  let remaining = { ...inv };
  for (const id of drawn) remaining = invRemove(remaining, id, 1).inv;
  return { drawn, remaining };
}

function ensureCanDraw(room: GameRoom, roomId: string, playerId: string): Player {
  if (room.currentPhase !== "ACTION") throw new Error("仅能在行动阶段抽卡。");
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  if (player.status === "shadow") throw new Error("暗影不能抽取道具卡。");
  if (player.endedAction) throw new Error("你已结束本轮行动，无法再抽卡。");
  if (!player.submittedAction || player.submittedAction.round !== room.currentRound) {
    throw new Error("请先提交本轮移动再使用房间功能。");
  }
  if (player.submittedAction.toRoom !== roomId) throw new Error("只能在你本轮的目标房间抽卡。");
  if (!isRoomFunctionAvailable(roomId, room)) throw new Error("该房间功能被黑客关闭，本轮无法抽取道具。");
  return player;
}

/**
 * 从一批抽到的道具中剔除当前玩家无法合法获得的道具（v1.0.3 §5.3，目前仅次元口袋）。
 * 被剔除的道具退回 roomId 库存。返回保留的道具与退回信息。
 */
function filterGainable(
  player: Player,
  roomId: string,
  drawn: string[],
  roomInv: GameRoom["roomInventories"][string]
): { kept: string[]; inv: GameRoom["roomInventories"][string]; rejected: string[] } {
  const kept: string[] = [];
  const rejected: string[] = [];
  let inv = roomInv;
  for (const id of drawn) {
    if (canGainItem(player, id).ok) kept.push(id);
    else {
      rejected.push(id);
      inv = invAdd(inv, id, 1); // 退回原房间库存
    }
  }
  return { kept, inv, rejected };
}

/**
 * 常规抽卡：从房间库存随机抽取 count 张（受抽卡上限与剩余库存限制）。
 * 垃圾场请用 drawFromTrash。
 */
export function drawItemsFromRoom(
  room: GameRoom,
  roomId: string,
  playerId: string,
  count: number
): GameRoom {
  const player = ensureCanDraw(room, roomId, playerId);
  if (player.submittedAction?.hasDrawnFromRoom) {
    throw new Error("每次行动只能抽一次卡，本轮已抽过。");
  }
  const limit = getDrawLimit(roomId);
  if (limit <= 0) throw new Error("该房间不可常规抽卡。");

  const inv = room.roomInventories[roomId] ?? {};
  const want = Math.min(count, limit);
  const { drawn, remaining } = drawRandom(inv, want);
  if (drawn.length === 0) throw new Error("房间库存已空。");

  // v1.0.3 §5.3：负重 0 无次元口袋时不能获得次元口袋——剔除并退回库存。
  const { kept, inv: roomInv, rejected } = filterGainable(player, roomId, drawn, remaining);

  const updatedPlayer: Player = recordDraw(
    { ...player, inventory: [...player.inventory, ...kept] },
    roomId,
    kept
  );
  let next = replacePlayer(room, updatedPlayer);
  next = {
    ...next,
    roomInventories: { ...next.roomInventories, [roomId]: roomInv },
  };
  // §3 / §13：抽卡结果为私密信息，仅本人面板可见，不进公共日志。
  next = appendPrivateLog(next, playerId, `你在 ${getRoomLabel(roomId)} 抽到：${kept.map(getItemName).join("、") || "无"}。`);
  if (rejected.length > 0) {
    next = appendPrivateLog(next, playerId, `（${rejected.map(getItemName).join("、")} 因负重为 0 无法获得，退回房间库存。）`);
  }
  return next;
}

/**
 * B503 垃圾场特殊抽卡（规则 14.1 / 开发指令 3.3.7）：
 * 随机抽最多 5 张；非垃圾道具最多保留 2 张，其余非垃圾退回库存；垃圾全部保留。
 * v0.2 自动保留前 2 张非垃圾（手动选择留待 v0.3）。
 */
export function drawFromTrash(room: GameRoom, playerId: string, count = 5): GameRoom {
  const roomId = "B503";
  const player = ensureCanDraw(room, roomId, playerId);
  if (player.submittedAction?.hasDrawnFromRoom) {
    throw new Error("每次行动只能抽一次卡，本轮已抽过。");
  }
  const inv = room.roomInventories[roomId] ?? {};
  const want = Math.min(count, getDrawLimit(roomId));
  const { drawn, remaining } = drawRandom(inv, want);
  if (drawn.length === 0) throw new Error("垃圾场库存已空。");

  const junk = drawn.filter((id) => isJunkItem(id));
  const nonJunk = drawn.filter((id) => !isJunkItem(id));
  const keptNonJunk = nonJunk.slice(0, 2);
  const returnedNonJunk = nonJunk.slice(2);

  let roomInv = remaining;
  for (const id of returnedNonJunk) roomInv = invAdd(roomInv, id, 1);

  const keptRaw = [...junk, ...keptNonJunk];
  // v1.0.3 §5.3：负重 0 无次元口袋时不能获得次元口袋——剔除并退回库存。
  const { kept, inv: finalInv, rejected } = filterGainable(player, roomId, keptRaw, roomInv);
  roomInv = finalInv;

  const updatedPlayer: Player = recordDraw(
    { ...player, inventory: [...player.inventory, ...kept] },
    roomId,
    kept
  );
  let next = replacePlayer(room, updatedPlayer);
  next = { ...next, roomInventories: { ...next.roomInventories, [roomId]: roomInv } };

  const desc =
    returnedNonJunk.length > 0
      ? `（非垃圾最多保留 2 张，${returnedNonJunk.map(getItemName).join("、")} 退回库存）`
      : "";
  next = appendPrivateLog(
    next,
    playerId,
    `你在 ${getRoomLabel(roomId)} 抽到：${kept.map(getItemName).join("、") || "无"}${desc}。`
  );
  if (rejected.length > 0) {
    next = appendPrivateLog(next, playerId, `（${rejected.map(getItemName).join("、")} 因负重为 0 无法获得，退回库存。）`);
  }
  return next;
}

/**
 * 金条抽卡（规则 15.1 / 开发指令 3.11.4 基础版）：
 * 玩家在可抽卡房间消耗 1 金条，额外选取该房间 1 张非金条道具。
 * 金条不可在 B206 金库、B503 垃圾场使用。
 */
export function useGoldDraw(
  room: GameRoom,
  roomId: string,
  playerId: string,
  pickItemId: string
): GameRoom {
  const player = ensureCanDraw(room, roomId, playerId);
  if (roomId === "B206" || roomId === "B503") throw new Error("金条不可在金库或垃圾场使用。");
  if (!player.inventory.includes("gold")) throw new Error("你没有金条。");
  if (pickItemId === "gold") throw new Error("金条不能选取金条。");
  // v1.0.3 §5.3：负重 0 无次元口袋时不能获得次元口袋。
  const gainCheck = canGainItem(player, pickItemId);
  if (!gainCheck.ok) throw new Error(gainCheck.reason!);

  const inv = room.roomInventories[roomId] ?? {};
  if ((inv[pickItemId] ?? 0) <= 0) throw new Error("该房间没有此道具。");

  // 消耗 1 金条 → 进入消耗堆
  const newHand = [...player.inventory];
  newHand.splice(newHand.indexOf("gold"), 1);
  newHand.push(pickItemId);
  const updatedPlayer: Player = { ...player, inventory: newHand };

  let next = replacePlayer(room, updatedPlayer);
  next = {
    ...next,
    roomInventories: { ...next.roomInventories, [roomId]: invRemove(inv, pickItemId, 1).inv },
    consumedPile: invAdd(next.consumedPile, "gold", 1),
  };
  next = appendPrivateLog(
    next,
    playerId,
    `你在 ${getRoomLabel(roomId)} 使用金条额外获得 ${getItemName(pickItemId)}。`
  );
  return next;
}

/** 领取一份停机坪空投（规则 14.2 / 开发指令 3.2.4 基础版） */
export function claimAirdrop(room: GameRoom, playerId: string, round: number): GameRoom {
  const player = ensureCanDraw(room, "202", playerId);
  const pile = room.airdrops.find((a) => a.round === round && !a.claimed);
  if (!pile) throw new Error("该空投不存在或已被领取。");

  const items = invToList(pile.items);
  // v1.0.3 §5.3：剔除负重 0 无法获得的次元口袋（空投表当前无口袋，留作统一防护）。
  const gainable = items.filter((id) => canGainItem(player, id).ok);
  const updatedPlayer: Player = { ...player, inventory: [...player.inventory, ...gainable] };
  let next = replacePlayer(room, updatedPlayer);
  next = {
    ...next,
    airdrops: next.airdrops.map((a) => (a.round === round ? { ...a, claimed: true } : a)),
  };
  next = appendPrivateLog(
    next,
    playerId,
    `你领取了${formatRoundLabel(round)}空投（${gainable.map(getItemName).join("、") || "无"}）。`
  );
  return next;
}

/**
 * 放弃在目标可抽卡房间抽卡（v1.0.2 §3 强制抽卡确认）：
 * 玩家明确选择不抽卡，记录 drawSkipped，使其可以结束行动。
 */
export function skipDraw(room: GameRoom, playerId: string): GameRoom {
  if (room.currentPhase !== "ACTION") throw new Error("仅能在行动阶段处理抽卡。");
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  if (!player.submittedAction) throw new Error("请先提交本轮移动。");
  if (player.submittedAction.hasDrawnFromRoom) throw new Error("本轮已抽卡，无需放弃。");
  const updated: Player = {
    ...player,
    submittedAction: { ...player.submittedAction, drawSkipped: true },
  };
  let next = replacePlayer(room, updated);
  next = appendPrivateLog(next, playerId, `你放弃了在 ${getRoomLabel(player.submittedAction.toRoom)} 的抽卡。`);
  return next;
}

/**
 * 丢弃道具（主动丢弃 / 超重处理）：道具留在玩家当前目标房间库存（规则 10.4）。
 */
export function discardItems(room: GameRoom, playerId: string, itemIds: string[]): GameRoom {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  const roomId = player.submittedAction?.toRoom ?? player.location;
  if (!roomId) throw new Error("无法确定丢弃地点。");

  const newHand = [...player.inventory];
  let roomInv = room.roomInventories[roomId] ?? {};
  for (const id of itemIds) {
    const idx = newHand.indexOf(id);
    if (idx === -1) continue;
    newHand.splice(idx, 1);
    roomInv = invAdd(roomInv, id, 1);
  }
  const updatedPlayer: Player = { ...player, inventory: newHand };
  let next = replacePlayer(room, updatedPlayer);
  next = { ...next, roomInventories: { ...next.roomInventories, [roomId]: roomInv } };
  next = appendPrivateLog(
    next,
    playerId,
    `你在 ${getRoomLabel(roomId)} 丢弃了 ${itemIds.length} 张道具。`
  );
  return next;
}

/**
 * 为某一轮生成停机坪空投（每轮 1 份，累积）。来源：规则 14.2。
 * 空投表按显示轮号（第 1~6 轮）定义；首轮（显示轮 0）无空投。
 */
export function addAirdropForRound(room: GameRoom, round: number): GameRoom {
  if (room.airdrops.some((a) => a.round === round)) return room;
  const items = airdropItemsByRound[displayRound(round)];
  if (!items) return room;
  return { ...room, airdrops: [...room.airdrops, { round, items: { ...items }, claimed: false }] };
}
