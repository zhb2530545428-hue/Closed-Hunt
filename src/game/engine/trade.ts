// 自由阶段交易系统。来源：规则手册 6.3（可交易顺位卡、道具卡；不可交易生命/基因/位置）。
// 交易流程：发起 → 对方接受/拒绝 → 接受后自动转移 → 双方负重检查（超重需自行丢弃）。

import type { GameRoom, Player, Trade } from "../types";
import { appendLog, nowISO, uid } from "./helpers";
import { getItemName } from "../config/items";
import { isOverweight, canGainItem } from "../inventory";
import { roleName } from "../utils/names";

/**
 * 校验顺位卡唯一性（v1.0.2 §2）：每名存活在座玩家必须恰好持有 1 张顺位卡，且全场不重复。
 * 顺位卡只能在玩家间「交换」（见 createTrade / respondTrade），交换保持顺位卡集合不变，
 * 因此该不变式在任意交易后都应成立；不成立则说明数据异常，应阻止并回滚。
 */
export function validateTurnOrderCards(room: GameRoom): { ok: boolean; reason?: string } {
  const alive = room.players.filter((p) => p.name && p.status === "alive");
  const seen = new Set<number>();
  for (const p of alive) {
    if (p.orderCard == null) return { ok: false, reason: `${p.name} 缺少顺位卡。` };
    if (seen.has(p.orderCard)) return { ok: false, reason: `顺位卡 ${p.orderCard} 被多名玩家持有。` };
    seen.add(p.orderCard);
  }
  return { ok: true };
}

function replacePlayers(room: GameRoom, updated: Player[]): GameRoom {
  const map = new Map(updated.map((p) => [p.id, p]));
  return {
    ...room,
    players: room.players.map((p) => map.get(p.id) ?? p),
    updatedAt: nowISO(),
  };
}

/** 统计列表中某 id 出现次数，校验 from 是否拥有全部 offerItems。 */
function hasAllItems(player: Player, items: string[]): boolean {
  const pool = [...player.inventory];
  for (const id of items) {
    const idx = pool.indexOf(id);
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  return true;
}

export interface TradeInput {
  toPlayerId: string;
  offerItems?: string[];
  offerOrderCard?: boolean;
  requestItems?: string[];
  requestOrderCard?: boolean;
  note?: string;
}

/** 发起交易（仅自由阶段）。 */
export function createTrade(room: GameRoom, fromPlayerId: string, input: TradeInput): GameRoom {
  if (room.currentPhase !== "FREE") throw new Error("仅能在自由阶段交易。");
  const from = room.players.find((p) => p.id === fromPlayerId);
  const to = room.players.find((p) => p.id === input.toPlayerId);
  if (!from || !from.name) throw new Error("发起方不存在。");
  if (!to || !to.name) throw new Error("交易对象不存在。");
  if (from.id === to.id) throw new Error("不能与自己交易。");

  const offerItems = input.offerItems ?? [];
  const requestItems = input.requestItems ?? [];
  // §2：顺位卡只能「交换」，禁止单向赠予（单向赠予会导致某人 0 张、某人 2 张）。
  // 任一方勾选顺位卡即统一视为双方交换各自的顺位卡。
  let offerOrderCard = !!input.offerOrderCard;
  let requestOrderCard = !!input.requestOrderCard;
  if (offerOrderCard || requestOrderCard) {
    offerOrderCard = true;
    requestOrderCard = true;
  }

  if (offerItems.length === 0 && requestItems.length === 0 && !offerOrderCard && !requestOrderCard) {
    throw new Error("交易内容不能为空。");
  }
  if (!hasAllItems(from, offerItems)) throw new Error("你没有要给出的全部道具。");
  if (offerOrderCard && from.orderCard == null) throw new Error("你当前没有顺位卡可交换。");
  if (requestOrderCard && to.orderCard == null) throw new Error("对方当前没有顺位卡可交换。");

  const trade: Trade = {
    id: uid("trade_"),
    round: room.currentRound,
    fromPlayerId,
    toPlayerId: to.id,
    offerItems,
    offerOrderCard,
    requestItems,
    requestOrderCard,
    note: input.note?.trim() || undefined,
    status: "pending",
    createdAt: nowISO(),
  };

  let next: GameRoom = { ...room, trades: [...room.trades, trade], updatedAt: nowISO() };
  next = appendLog(next, `${roleName(from)} 向 ${roleName(to)} 发起一笔交易请求。`);
  return next;
}

function setTradeStatus(room: GameRoom, tradeId: string, status: Trade["status"]): Trade[] {
  return room.trades.map((t) =>
    t.id === tradeId ? { ...t, status, resolvedAt: nowISO() } : t
  );
}

/** 对方响应交易：接受则自动转移并双方负重检查；拒绝则关闭。 */
export function respondTrade(room: GameRoom, tradeId: string, accept: boolean): GameRoom {
  // §2.4.7：行动阶段开始后禁止继续交易顺位卡（交易仅在自由阶段有效）。
  if (room.currentPhase !== "FREE") throw new Error("仅能在自由阶段处理交易。");
  const trade = room.trades.find((t) => t.id === tradeId);
  if (!trade) throw new Error("交易不存在。");
  if (trade.status !== "pending") throw new Error("该交易已处理。");

  const from = room.players.find((p) => p.id === trade.fromPlayerId);
  const to = room.players.find((p) => p.id === trade.toPlayerId);
  if (!from || !to) throw new Error("交易玩家不存在。");

  if (!accept) {
    let next: GameRoom = { ...room, trades: setTradeStatus(room, tradeId, "rejected"), updatedAt: nowISO() };
    next = appendLog(next, `${roleName(to)} 拒绝了 ${roleName(from)} 的交易。`);
    return next;
  }

  // 接受前重新校验双方仍持有承诺物
  if (!hasAllItems(from, trade.offerItems)) throw new Error("发起方已不具备承诺给出的道具，交易失效。");
  if (!hasAllItems(to, trade.requestItems)) throw new Error("你没有对方索取的全部道具。");
  if (trade.offerOrderCard && from.orderCard == null) throw new Error("发起方没有顺位卡，交易失效。");
  if (trade.requestOrderCard && to.orderCard == null) throw new Error("你没有顺位卡可给出。");
  // v1.0.3 §5.3：负重 0 无次元口袋的一方不能通过交易获得次元口袋。
  for (const id of trade.offerItems) {
    const c = canGainItem(to, id);
    if (!c.ok) throw new Error(`${roleName(to)}：${c.reason}`);
  }
  for (const id of trade.requestItems) {
    const c = canGainItem(from, id);
    if (!c.ok) throw new Error(`${roleName(from)}：${c.reason}`);
  }

  const nf: Player = { ...from, inventory: [...from.inventory] };
  const nt: Player = { ...to, inventory: [...to.inventory] };

  // 道具转移
  for (const id of trade.offerItems) {
    nf.inventory.splice(nf.inventory.indexOf(id), 1);
    nt.inventory.push(id);
  }
  for (const id of trade.requestItems) {
    nt.inventory.splice(nt.inventory.indexOf(id), 1);
    nf.inventory.push(id);
  }
  // 顺位卡只能「交换」（§2）：双方互换各自顺位卡，保持全场顺位卡集合不变，杜绝复制/堆叠/丢失。
  const involvesOrderCard = trade.offerOrderCard || trade.requestOrderCard;
  if (involvesOrderCard) {
    if (nf.orderCard == null || nt.orderCard == null) {
      throw new Error("顺位卡交换失效：双方需各持 1 张顺位卡。");
    }
    const tmp = nf.orderCard;
    nf.orderCard = nt.orderCard;
    nt.orderCard = tmp;
  }

  let next = replacePlayers(room, [nf, nt]);
  next = { ...next, trades: setTradeStatus(next, tradeId, "accepted") };
  // §2.4.4/2.4.5：交易完成后立即校验顺位卡唯一性，异常则阻止并回滚（纯函数抛错即回滚乐观更新）。
  if (involvesOrderCard) {
    const check = validateTurnOrderCards(next);
    if (!check.ok) throw new Error(`顺位卡校验失败：${check.reason}`);
  }
  next = appendLog(next, `${roleName(to)} 接受了与 ${roleName(from)} 的交易，物品已转移。`);

  const offerText = [
    ...trade.offerItems.map(getItemName),
    ...(trade.offerOrderCard ? ["顺位卡"] : []),
  ].join("、");
  const requestText = [
    ...trade.requestItems.map(getItemName),
    ...(trade.requestOrderCard ? ["顺位卡"] : []),
  ].join("、");
  next = appendLog(next, `  ${roleName(from)} 给出：${offerText || "（无）"}；${roleName(to)} 给出：${requestText || "（无）"}。`);

  if (isOverweight(nf)) next = appendLog(next, `  ${roleName(nf)} 交易后超重，请在行动前丢弃多余道具。`);
  if (isOverweight(nt)) next = appendLog(next, `  ${roleName(nt)} 交易后超重，请在行动前丢弃多余道具。`);
  return next;
}

/** 取消交易（发起方或房主）。 */
export function cancelTrade(room: GameRoom, tradeId: string): GameRoom {
  const trade = room.trades.find((t) => t.id === tradeId);
  if (!trade) throw new Error("交易不存在。");
  if (trade.status !== "pending") throw new Error("该交易已处理，无法取消。");
  const from = room.players.find((p) => p.id === trade.fromPlayerId);
  let next: GameRoom = { ...room, trades: setTradeStatus(room, tradeId, "cancelled"), updatedAt: nowISO() };
  next = appendLog(next, `${from ? roleName(from) : "玩家"} 的交易已取消。`);
  return next;
}

/** 某玩家相关的待处理交易（收到的 / 发出的）。 */
export function pendingTradesFor(room: GameRoom, playerId: string): { incoming: Trade[]; outgoing: Trade[] } {
  const pending = room.trades.filter((t) => t.status === "pending");
  return {
    incoming: pending.filter((t) => t.toPlayerId === playerId),
    outgoing: pending.filter((t) => t.fromPlayerId === playerId),
  };
}
