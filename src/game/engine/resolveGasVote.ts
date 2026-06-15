// 毒气投票结算。来源：规则手册 7.7、11；开发指令 8.5。
// v0.1 必须自动统计。

import type { GameRoom, ResolveResult } from "../types";
import { getFloorLabel } from "../config/floors";

/**
 * 统计本轮毒气投票：
 * - 仅统计存活玩家的投票（暗影不投票）；
 * - 已是毒气楼层的楼层不再计票；
 * - 得票最高楼层成为毒气楼层；并列最高全部成为毒气楼层。
 * 返回新增的毒气楼层与可读结果（不直接修改 room，由 resolveRound 应用）。
 */
export function resolveGasVote(room: GameRoom): {
  newGasFloors: string[];
  tally: Record<string, number>;
  result: ResolveResult;
} {
  const tally: Record<string, number> = {};
  for (const p of room.players) {
    if (p.status !== "alive") continue;
    const vote = p.submittedAction?.gasVoteFloor;
    if (!vote) continue;
    if (room.gasFloors.includes(vote)) continue; // 已是毒气楼层，不再计票
    tally[vote] = (tally[vote] ?? 0) + 1;
  }

  const entries = Object.entries(tally);
  let newGasFloors: string[] = [];
  if (entries.length > 0) {
    const max = Math.max(...entries.map(([, n]) => n));
    newGasFloors = entries.filter(([, n]) => n === max).map(([floor]) => floor);
  }

  let message: string;
  if (newGasFloors.length === 0) {
    message = `第 ${room.currentRound} 轮毒气投票结果：无有效投票，未产生新的毒气楼层。`;
  } else if (newGasFloors.length === 1) {
    message = `第 ${room.currentRound} 轮毒气投票结果：${getFloorLabel(newGasFloors[0])} 成为毒气楼层。`;
  } else {
    const labels = newGasFloors.map(getFloorLabel).join("、");
    message = `第 ${room.currentRound} 轮毒气投票结果：${labels} 并列最高，均成为毒气楼层。`;
  }

  const tallyText =
    entries.length > 0
      ? entries
          .sort((a, b) => b[1] - a[1])
          .map(([f, n]) => `${getFloorLabel(f)}:${n}票`)
          .join("，")
      : "无有效票";

  return {
    newGasFloors,
    tally,
    result: {
      status: "auto",
      title: "毒气投票",
      autoInfo: `${message}\n计票：${tallyText}`,
      logs: [message],
    },
  };
}
