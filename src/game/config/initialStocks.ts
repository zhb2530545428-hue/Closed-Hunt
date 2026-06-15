// 房间初始库存。来源：规则手册 14.1 房间功能表。
// 以 itemId -> 数量 表示。仅列出有初始库存的房间，其余房间初始为空。

import type { Inventory } from "../types";
export type { Inventory };

export const INITIAL_STOCKS: Record<string, Inventory> = {
  "101": { water: 10 },
  "B107": { knife: 5, pistol: 2, shotgun: 1 },
  "B206": { gold: 4 },
  "B301": { pill: 3, adrenaline: 3 },
  "B501": { water: 5, food: 5, knife: 3, wine: 2, pill: 2, adrenaline: 2, pistol: 1, gold: 1, shotgun: 1 },
  "B503": { junk: 20, rope: 1, gasmask: 1, rocket: 1, pocket: 1, recycler: 1 },
  "B505": { food: 10 },
  "B601": { wine: 6 },
  // B701 停尸间：死亡玩家遗物，初始为空
};

/** 返回某房间的初始库存副本（无则空对象） */
export function initialStockFor(roomId: string): Inventory {
  return { ...(INITIAL_STOCKS[roomId] ?? {}) };
}
