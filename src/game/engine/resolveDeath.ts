// 死亡 / 复活检查骨架。来源：规则手册 8.2、13.1；开发指令 9.2。

import type { GameRoom, ResolveResult } from "../types";

export function resolveDeath(room: GameRoom): ResolveResult {
  // 自动提示当前生命值为 0 的存活玩家（死亡检查在结算最后统一执行）
  const dying = room.players.filter((p) => p.status === "alive" && p.hp <= 0);
  const info =
    dying.length === 0
      ? "暂无生命值为 0 的存活玩家。"
      : `生命值为 0、将成为暗影：${dying.map((p) => p.name).join("、")}`;
  return {
    status: "manual_required",
    title: "死亡 / 复活检查",
    autoInfo: `${info}\n\nv0.1 暂不自动结算死亡与复活，请房主根据规则手册 8.2 / 13 确认，并在控制台手动将相应玩家设为暗影或复活。`,
  };
}
