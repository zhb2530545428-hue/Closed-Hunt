// 轮次配置。来源：规则手册 5、11.2 毒气伤害、12 水粮、14.2 空投表。
//
// v1.0.2 §7 轮次表达（用户定义，UI/程序以此为准）：
//   一共 7 个行动轮次 = 首轮 + 第 1 轮 … 第 6 轮。
//   「首轮」是开局首轮，不计入正式 6 轮：无毒气伤害、无水粮、无空投。
// 内部 currentRound 取 1..7：round 1 = 首轮，round r = 第 (r-1) 轮。
// 规则手册中「第 N 轮」「从第 2 轮开始」等表述统一按本映射换算到内部轮号。

import type { Inventory } from "./initialStocks";

/** 内部总轮数：首轮(1) + 第 1~6 轮(2..7)。 */
export const TOTAL_ROUNDS = 7;

/** 内部轮号 → 显示轮号（首轮记为 0，第 N 轮记为 N）。 */
export function displayRound(internalRound: number): number {
  return internalRound - 1;
}

/** 轮次显示标签：1→「首轮」，r→「第 (r-1) 轮」。 */
export function formatRoundLabel(internalRound: number): string {
  if (internalRound <= 1) return "首轮";
  return `第 ${internalRound - 1} 轮`;
}

/**
 * 各轮毒气伤害（按内部轮号）。来源：规则手册 11.2（第 1~6 轮 -1/-2/-2/-3/-3/-4）。
 * 首轮（内部 1）不产生毒气伤害。
 */
export const roundGasDamage: Record<number, number> = {
  2: 1, // 第 1 轮
  3: 2, // 第 2 轮
  4: 2, // 第 3 轮
  5: 3, // 第 4 轮
  6: 3, // 第 5 轮
  7: 4, // 第 6 轮
};

/** 水粮从「第 1 轮」开始上交（内部轮号 2）。来源：规则手册 12.1（从第 2 轮起）按映射换算。 */
export const FOOD_WATER_START_ROUND = 2;

/** 停机坪空投表（文字，按显示轮号 1~6）。来源：规则手册 14.2。 */
export const airdropByRound: Record<number, string> = {
  1: "2 刀",
  2: "2 果汁",
  3: "1 水 + 1 粮食",
  4: "1 手枪",
  5: "1 肾上腺素",
  6: "1 药片",
};

/** 停机坪空投表（结构化，按显示轮号 1~6，itemId -> 数量）。来源：规则手册 14.2。 */
export const airdropItemsByRound: Record<number, Inventory> = {
  1: { knife: 2 },
  2: { juice: 2 },
  3: { water: 1, food: 1 },
  4: { pistol: 1 },
  5: { adrenaline: 1 },
  6: { pill: 1 },
};
