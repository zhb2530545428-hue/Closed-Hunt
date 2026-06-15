// 火箭筒结算骨架。来源：规则手册 15.1 火箭筒；开发指令 9.2。

import type { GameRoom, ResolveResult } from "../types";

export function resolveRocket(room: GameRoom): ResolveResult {
  return {
    status: "manual_required",
    title: "火箭筒结算",
    autoInfo:
      "持有火箭筒的玩家可在行动阶段指定 1 个房间袭击，结算时该房间内每名存活玩家 -4（暗影不受影响）。\n\nv0.1 暂不自动结算，请房主根据规则手册确认被袭房间并手动扣血。",
  };
}
