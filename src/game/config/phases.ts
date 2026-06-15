// 阶段与结算步骤配置。来源：规则手册 5-8。

import type { GamePhase } from "../types";

export interface PhaseInfo {
  id: GamePhase;
  label: string;
  description: string;
}

export const PHASE_INFO: Record<GamePhase, PhaseInfo> = {
  LOBBY: {
    id: "LOBBY",
    label: "大厅",
    description: "玩家加入、设置昵称、职业、基因点、出生房间并准备。",
  },
  SETUP: {
    id: "SETUP",
    label: "初始化",
    description: "游戏初始化中。",
  },
  FREE: {
    id: "FREE",
    label: "自由阶段",
    description: "玩家可以交流、交易顺位卡和道具卡。自由阶段结束前需检查负重。",
  },
  ACTION: {
    id: "ACTION",
    label: "行动阶段",
    description: "玩家按顺位卡顺序行动：移动、使用房间功能、提交毒气投票。",
  },
  RESOLUTION: {
    id: "RESOLUTION",
    label: "结算阶段",
    description: "按固定顺序结算 8 个步骤，全部确认后进入下一轮。",
  },
  GAME_OVER: {
    id: "GAME_OVER",
    label: "游戏结束",
    description: "第 6 轮结算完成，进行最终排名。",
  },
};

/** 结算固定顺序。来源：规则手册 8.1。 */
export interface ResolutionStepDef {
  key: string;
  title: string;
}

export const RESOLUTION_STEPS: ResolutionStepDef[] = [
  { key: "roomEffects", title: "1. 房间效果" },
  { key: "combat", title: "2. 战斗 / 乱斗" },
  { key: "shadow", title: "3. 暗影吸血" },
  { key: "rocket", title: "4. 火箭筒" },
  { key: "gas", title: "5. 毒气" },
  { key: "foodWater", title: "6. 水粮" },
  { key: "itemStatus", title: "7. 道具回血 / 状态" },
  { key: "deathRevive", title: "8. 死亡 / 复活检查" },
];
