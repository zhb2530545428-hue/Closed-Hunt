// 轮次配置。来源：规则手册 5、11.2 毒气伤害、12 水粮、14.2 空投表。
//
// v1.0.4：首轮出生战斗不是正式轮次。
// currentRound=0 仅用于「首轮出生战斗结算」阶段；正式轮次为 1..6。

import type { Inventory } from "./initialStocks";

/** 正式总轮数：第 1~6 轮。 */
export const TOTAL_ROUNDS = 6;

/** 内部轮号 → 显示轮号。 */
export function displayRound(internalRound: number): number {
  return Math.max(0, internalRound);
}

/** 轮次显示标签：0→「首轮出生战斗」，1..6→「第 N 轮」。 */
export function formatRoundLabel(internalRound: number): string {
  if (internalRound <= 0) return "首轮出生战斗";
  return `第 ${internalRound} 轮`;
}

/**
 * 各正式轮毒气伤害。来源：规则手册 11.2（第 1~6 轮 -1/-2/-2/-3/-3/-4）。
 */
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
