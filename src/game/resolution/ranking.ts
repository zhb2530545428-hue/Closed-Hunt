// 最终结算与排名。来源：规则手册 17。

import type { GameRoom, Player, RankEntry } from "../types";

/** 金魔方积分：第 1 名 9 分 …… 末名 1 分（按实际人数线性）。来源：规则手册 17.5。 */
function pointsForRank(rank: number, total: number): number {
  return Math.max(0, total - rank + 1);
}

/**
 * 最终结算金条兑换：存活玩家手中金条 1 张兑 1 生命，不超过上限。来源：规则手册 17.2。
 * 返回新玩家数组与日志。
 */
export function applyFinalGoldConversion(players: Player[]): { players: Player[]; logs: string[] } {
  const logs: string[] = [];
  const next = players.map((p) => {
    if (p.status !== "alive") return p;
    const golds = p.inventory.filter((id) => id === "gold").length;
    if (golds === 0) return p;
    const gain = Math.min(golds, p.maxHp - p.hp);
    if (gain <= 0) return p;
    logs.push(`${p.name} 用 ${gain} 金条兑换 ${gain} 点生命（${p.hp} → ${p.hp + gain}）。`);
    return { ...p, hp: p.hp + gain };
  });
  return { players: next, logs };
}

/**
 * 排名（规则 17.3 / 17.4）：
 * - 全员暗影：按生前上一轮生命值（lastRoundHp）降序，再按武力；
 * - 否则：存活优先 → 生命值 → 武力；暗影间按生前武力。
 */
export function computeRanking(room: GameRoom): RankEntry[] {
  const seated = room.players.filter((p) => p.name);
  const allShadow = seated.length > 0 && seated.every((p) => p.status === "shadow");

  const sorted = [...seated].sort((a, b) => {
    if (allShadow) {
      const ah = a.lastRoundHp ?? 0;
      const bh = b.lastRoundHp ?? 0;
      if (bh !== ah) return bh - ah;
      return b.force - a.force;
    }
    const aAlive = a.status === "alive";
    const bAlive = b.status === "alive";
    if (aAlive !== bAlive) return aAlive ? -1 : 1;
    if (aAlive) {
      if (b.hp !== a.hp) return b.hp - a.hp;
      return b.force - a.force;
    }
    return b.force - a.force; // 暗影按生前武力
  });

  const total = sorted.length;
  return sorted.map((p, i) => ({ playerId: p.id, rank: i + 1, points: pointsForRank(i + 1, total) }));
}

/** 兼容旧调用名 */
export const basicRanking = computeRanking;
