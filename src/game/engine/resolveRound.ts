// 构建本轮结算步骤。来源：规则手册 8.1；开发指令 8.4。
// v0.1：毒气投票自动结算并落地，其余步骤生成“待房主确认”卡片。

import type { GameRoom, ResolutionStep } from "../types";
import { RESOLUTION_STEPS } from "../config/phases";
import { appendLog, nowISO } from "./helpers";
import { resolveGasVote } from "./resolveGasVote";
import { resolveRoomEffects } from "./resolveRoomEffects";
import { resolveCombat } from "./resolveCombat";
import { resolveShadow } from "./resolveShadow";
import { resolveRocket } from "./resolveRocket";
import { resolveFoodAndWater } from "./resolveFoodAndWater";
import { resolveDeath } from "./resolveDeath";

/**
 * 进入结算阶段：生成 8 个结算步骤卡片，自动落地毒气楼层并写日志。
 * 返回的房间 currentPhase = RESOLUTION。
 */
export function buildResolution(room: GameRoom): GameRoom {
  const gas = resolveGasVote(room);

  // autoInfo 提供方，对应固定结算顺序
  const infoByKey: Record<string, { autoInfo: string; status: ResolutionStep["status"] }> = {
    roomEffects: pick(resolveRoomEffects(room)),
    combat: pick(resolveCombat(room)),
    shadow: pick(resolveShadow(room)),
    rocket: pick(resolveRocket(room)),
    gas: { autoInfo: gas.result.autoInfo, status: "auto" },
    foodWater: pick(resolveFoodAndWater(room)),
    itemStatus: {
      autoInfo:
        "药片 +2、酒掷骰、肾上腺素生效、手术室 +4 等在此结算。\n\nv0.1 暂不自动结算，请房主根据规则手册 15 / 16 确认。",
      status: "manual_required",
    },
    deathRevive: pick(resolveDeath(room)),
  };

  const steps: ResolutionStep[] = RESOLUTION_STEPS.map((def) => ({
    key: def.key,
    title: def.title,
    status: infoByKey[def.key]?.status ?? "manual_required",
    autoInfo: infoByKey[def.key]?.autoInfo ?? "",
    hostNotes: "",
    confirmed: false,
  }));

  let next: GameRoom = {
    ...room,
    currentPhase: "RESOLUTION",
    status: "RESOLUTION",
    gasFloors: [...room.gasFloors, ...gas.newGasFloors],
    resolutionSteps: steps,
    updatedAt: nowISO(),
  };
  for (const msg of gas.result.logs ?? []) {
    next = appendLog(next, msg);
  }
  return next;
}

function pick(r: { autoInfo: string; status: ResolutionStep["status"] }) {
  return { autoInfo: r.autoInfo, status: r.status };
}

/** 是否所有结算步骤都已确认 */
export function allStepsConfirmed(room: GameRoom): boolean {
  return room.resolutionSteps.length > 0 && room.resolutionSteps.every((s) => s.confirmed);
}
