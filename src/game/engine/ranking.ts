// 最终排名。来源：规则手册 17.3 排名规则、17.5 金魔方积分。

import type { GameRoom, Player } from "../types";

export interface RankEntry {
  player: Player;
  rank: number;
  points: number;
}

/** 金魔方积分：第 1 名 9 分 …… 第 9 名 1 分。 */
function pointsForRank(rank: number, total: number): number {
  return Math.max(0, total - rank + 1);
}

/**
 * 基础排名（basicRanking）：
 * 1. 存活玩家排在暗影之前；
 * 2. 存活玩家间生命值高者靠前，相同则武力高者靠前；
 * 3. 暗影间生前武力高者靠前。
 */
export function basicRanking(room: GameRoom): RankEntry[] {
  const seated = room.players.filter((p) => p.name);
  const sorted = [...seated].sort((a, b) => {
    const aAlive = a.status === "alive";
    const bAlive = b.status === "alive";
    if (aAlive !== bAlive) return aAlive ? -1 : 1;
    if (aAlive) {
      if (b.hp !== a.hp) return b.hp - a.hp;
      return b.force - a.force;
    }
    // 均为暗影：生前武力高者靠前
    return b.force - a.force;
  });

  const total = sorted.length;
  return sorted.map((player, i) => ({
    player,
    rank: i + 1,
    points: pointsForRank(i + 1, total),
  }));
}
