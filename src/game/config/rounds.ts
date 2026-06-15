// 轮次配置。来源：规则手册 5（共 6 轮）、11.2 毒气伤害、12 水粮、14.2 空投表。

import type { Inventory } from "./initialStocks";

export const TOTAL_ROUNDS = 6;

/** 各轮毒气伤害。来源：规则手册 11.2。 */
export const roundGasDamage: Record<number, number> = {
  1: 1,
  2: 2,
  3: 2,
  4: 3,
  5: 3,
  6: 4,
};

/** 水粮从第 2 轮开始上交。来源：规则手册 12.1。 */
export const FOOD_WATER_START_ROUND = 2;

/** 停机坪空投表（文字）。来源：规则手册 14.2。 */
export const airdropByRound: Record<number, string> = {
  1: "2 刀",
  2: "2 酒",
  3: "1 水 + 1 粮食",
  4: "1 手枪",
  5: "1 肾上腺素",
  6: "1 药片",
};

/** 停机坪空投表（结构化，itemId -> 数量）。来源：规则手册 14.2。 */
export const airdropItemsByRound: Record<number, Inventory> = {
  1: { knife: 2 },
  2: { wine: 2 },
  3: { water: 1, food: 1 },
  4: { pistol: 1 },
  5: { adrenaline: 1 },
  6: { pill: 1 },
};
