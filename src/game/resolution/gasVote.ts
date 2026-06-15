// 毒气投票统计（纯函数）。来源：规则手册 7.7、11.1；开发指令 3.7.1。

import type { Player } from "../types";

export interface GasTally {
  /** 本轮新产生的毒气楼层 */
  newFloors: string[];
  /** 各楼层票数（含权重） */
  tally: Record<string, number>;
}

/**
 * 统计毒气投票：
 * - 仅存活玩家投票（暗影不投）；
 * - 已是毒气楼层的不再计票；
 * - 控制室「1 票视为 10 票」按权重计入（roomAction === "control_vote10"）；
 * - 得票最高楼层成为毒气楼层，并列全中。
 */
export function tallyGasVotes(players: Player[], existingGasFloors: string[]): GasTally {
  const tally: Record<string, number> = {};
  for (const p of players) {
    if (p.status !== "alive") continue;
    const vote = p.submittedAction?.gasVoteFloor;
    if (!vote) continue;
    if (existingGasFloors.includes(vote)) continue;
    const weight = p.submittedAction?.roomAction === "control_vote10" ? 10 : 1;
    tally[vote] = (tally[vote] ?? 0) + weight;
  }

  const entries = Object.entries(tally);
  if (entries.length === 0) return { newFloors: [], tally };
  const max = Math.max(...entries.map(([, n]) => n));
  const newFloors = entries.filter(([, n]) => n === max).map(([f]) => f);
  return { newFloors, tally };
}
