// 水粮结算骨架。来源：规则手册 12；开发指令 9.2。

import type { GameRoom, ResolveResult } from "../types";
import { FOOD_WATER_START_ROUND } from "../config/rounds";

export function resolveFoodAndWater(room: GameRoom): ResolveResult {
  if (room.currentRound < FOOD_WATER_START_ROUND) {
    return {
      status: "auto",
      title: "水粮结算",
      autoInfo: `第 ${room.currentRound} 轮无需上交水粮（从第 ${FOOD_WATER_START_ROUND} 轮开始）。`,
    };
  }
  return {
    status: "manual_required",
    title: "水粮结算",
    autoInfo:
      "存活玩家需上交 1 水 + 1 粮食：缺一 -1，全缺 -2；位于 B204 餐厅 / 暗影 / 复活当轮免除。\n\nv0.1 暂不自动结算，请房主根据规则手册第 12 节确认。",
  };
}
