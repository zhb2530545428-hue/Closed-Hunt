// 库存与负重工具。来源：规则手册 10 负重与道具、3.2 雇佣兵。

import type { Inventory, Player } from "./types";
import { getItem, isWeaponItem } from "./config/items";

// —— Inventory(Record) 基础操作 ——

export function invClone(inv: Inventory): Inventory {
  return { ...inv };
}

export function invAdd(inv: Inventory, id: string, n = 1): Inventory {
  const next = { ...inv };
  next[id] = (next[id] ?? 0) + n;
  if (next[id] <= 0) delete next[id];
  return next;
}

/** 从库存移除 n 个，返回 { inv, removed }（removed 为实际移除数量） */
export function invRemove(inv: Inventory, id: string, n = 1): { inv: Inventory; removed: number } {
  const have = inv[id] ?? 0;
  const removed = Math.min(have, n);
  const next = { ...inv };
  if (removed >= have) delete next[id];
  else next[id] = have - removed;
  return { inv: next, removed };
}

export function invTotal(inv: Inventory): number {
  return Object.values(inv).reduce((a, b) => a + b, 0);
}

/** 展开为 id 列表（按数量重复） */
export function invToList(inv: Inventory): string[] {
  const out: string[] = [];
  for (const [id, n] of Object.entries(inv)) {
    for (let i = 0; i < n; i++) out.push(id);
  }
  return out;
}

/** id 列表聚合为 Inventory */
export function listToInv(list: string[]): Inventory {
  const inv: Inventory = {};
  for (const id of list) inv[id] = (inv[id] ?? 0) + 1;
  return inv;
}

// —— 负重 ——

const MERCENARY = "mercenary";
const POCKET = "pocket"; // 次元口袋

/** 该玩家是否持有次元口袋 */
export function hasPocket(player: Player): boolean {
  return player.inventory.includes(POCKET);
}

/**
 * 玩家当前负重占用。
 * - 每张道具卡占 1（按 item.weight）；
 * - 雇佣兵的武器（刀/手枪/霰弹枪）不占负重（规则 3.2）。
 */
export function getInventoryWeight(player: Player): number {
  const isMercenary = player.roleId === MERCENARY;
  let weight = 0;
  for (const id of player.inventory) {
    if (isMercenary && isWeaponItem(id)) continue;
    weight += getItem(id)?.weight ?? 1;
  }
  return weight;
}

/** 负重上限：持有次元口袋视为无限（规则 10.3）。 */
export function getCarryLimit(player: Player): number {
  if (hasPocket(player)) return Infinity;
  return player.load;
}

export function isOverweight(player: Player): boolean {
  return getInventoryWeight(player) > getCarryLimit(player);
}

/** 超出负重的数量（不超重为 0） */
export function overweightAmount(player: Player): number {
  return Math.max(0, getInventoryWeight(player) - getCarryLimit(player));
}
