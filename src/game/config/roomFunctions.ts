// 房间功能配置。来源：规则手册 14.1 房间功能表。
// v0.1 用于展示房间功能与抽卡上限；抽卡/库存结算留待 v0.2。

import type { GameRoom } from "../types";
import type { Player } from "../types";

export interface RoomFunctionConfig {
  roomId: string;
  name: string;
  effect: string;
  /** 抽卡上限，"special" 表示特殊（如停机坪空投） */
  drawLimit: number | "special";
  /** 初始库存描述 */
  initialStock: string;
}

export const ROOM_FUNCTIONS: RoomFunctionConfig[] = [
  { roomId: "201", name: "基因库", effect: "三项属性各永久 +1，并可立即查看所有玩家当前基因面板。", drawLimit: 0, initialStock: "无" },
  { roomId: "202", name: "停机坪", effect: "不受毒气；下一轮可消耗 1 步搭直升机；每轮 1 份空投可累积，进入者任选 1 份（先到先得）。", drawLimit: "special", initialStock: "见空投表" },
  { roomId: "101", name: "水塔", effect: "抽取水。", drawLimit: 4, initialStock: "10 水" },
  { roomId: "102", name: "激光室", effect: "存活玩家经过或停留立即扣 1 点生命；暗影不受影响。", drawLimit: 0, initialStock: "无" },
  { roomId: "B101", name: "控制室", effect: "二选一：①本轮自己毒气投票 1 票视为 10 票；②解除一个已处毒气房间的毒气（不公开）。", drawLimit: 0, initialStock: "无" },
  { roomId: "B105", name: "回收站", effect: "经过时可消耗 1 步通过垃圾管道单向滑行至 B503 垃圾场。", drawLimit: 0, initialStock: "无" },
  { roomId: "B107", name: "武器库", effect: "抽取武器。", drawLimit: 2, initialStock: "5 刀、2 手枪、1 霰弹枪" },
  { roomId: "B202", name: "手术室", effect: "2 人：每人生命 +4 且不战斗；超过 2 人：不手术，触发乱斗。", drawLimit: 0, initialStock: "无" },
  { roomId: "B204", name: "餐厅", effect: "本轮结算阶段无需上交水粮。", drawLimit: 0, initialStock: "无" },
  { roomId: "B206", name: "金库", effect: "抽取金条。", drawLimit: 2, initialStock: "4 金条" },
  { roomId: "B301", name: "药房", effect: "抽取药片、肾上腺素。", drawLimit: 2, initialStock: "3 药片、3 肾上腺素" },
  { roomId: "B304", name: "操作室", effect: "可立即重新分配自己的基因点数。", drawLimit: 0, initialStock: "无" },
  { roomId: "B403", name: "传送室", effect: "经过时可消耗 1 步传送至任意普通房间。", drawLimit: 0, initialStock: "无" },
  { roomId: "B501", name: "大仓库", effect: "抽取综合物资；B4 与 B5 都成为毒气楼层时本房间才成为毒气区域。", drawLimit: 3, initialStock: "5 水、5 粮、3 刀、2 果汁、2 药片、2 肾上腺素、1 手枪、1 金条、1 霰弹枪" },
  { roomId: "B503", name: "垃圾场", effect: "最多抽 5 张；无法使用金条；一次抽到 2 张以上非垃圾道具时最多选 2 张非垃圾道具。", drawLimit: 5, initialStock: "20 垃圾、1 绳索、1 防毒面具、1 火箭筒、1 次元口袋、1 循环回收装置" },
  { roomId: "B505", name: "粮仓", effect: "抽取粮食。", drawLimit: 4, initialStock: "10 粮食" },
  { roomId: "B601", name: "酒窖", effect: "抽取果汁。", drawLimit: 2, initialStock: "6 果汁" },
  { roomId: "B701", name: "停尸间", effect: "抽取本轮前所有死亡玩家留下的道具卡。", drawLimit: 3, initialStock: "死亡玩家遗物" },
];

export function getRoomFunction(roomId: string): RoomFunctionConfig | undefined {
  return ROOM_FUNCTIONS.find((f) => f.roomId === roomId);
}

/** 房间数字抽卡上限；无抽卡或特殊（停机坪）返回 0。 */
export function getDrawLimit(roomId: string): number {
  const fn = getRoomFunction(roomId);
  if (!fn || typeof fn.drawLimit !== "number") return 0;
  return fn.drawLimit;
}

/** 该房间是否可常规抽卡（库存型房间，排除停机坪特殊与无库存功能房间） */
export function isDrawRoom(roomId: string): boolean {
  return getDrawLimit(roomId) > 0;
}

const RESOLUTION_ROOM_FUNCTIONS = new Set(["B202", "B204"]);

function closeRecordsFor(roomId: string, room: GameRoom) {
  const records = room.closedRoomRecords ?? [];
  if (records.length > 0) return records.filter((r) => r.roomId === roomId && r.round === room.currentRound);
  return (room.closedRooms ?? []).includes(roomId)
    ? [{ roomId, round: room.currentRound, closedByPlayerId: "", actionOrder: null, closedAt: "" }]
    : [];
}

function actionOrderOf(playerOrOrder: Player | number | null | undefined): number | null {
  if (typeof playerOrOrder === "number") return playerOrOrder;
  return playerOrOrder?.orderCard ?? null;
}

export function isResolutionRoomFunction(roomId: string): boolean {
  return RESOLUTION_ROOM_FUNCTIONS.has(roomId);
}

/**
 * 行动阶段即时房间效果：抽卡、基因库、控制室、操作室等。
 * 黑客关闭只影响黑客行动之后才进入或使用该房间功能的玩家；不会回溯取消先行动者。
 */
export function isRoomFunctionDisabledForAction(
  roomId: string,
  room: GameRoom,
  playerOrOrder?: Player | number | null
): boolean {
  const records = closeRecordsFor(roomId, room);
  if (records.length === 0) return false;
  const playerOrder = actionOrderOf(playerOrOrder);
  return records.some((record) => {
    if (record.actionOrder == null || playerOrder == null) return true;
    return playerOrder > record.actionOrder;
  });
}

/**
 * 结算阶段房间效果：餐厅、手术室等。
 * 只要该房间在本轮结算前被黑客关闭，结算时统一失效，不区分进入先后。
 */
export function isRoomFunctionDisabledForResolution(roomId: string, room: GameRoom): boolean {
  return closeRecordsFor(roomId, room).length > 0;
}

/**
 * 兼容旧调用：按结算阶段口径判断房间功能是否可用。
 * 新代码应优先使用 isRoomFunctionDisabledForAction / isRoomFunctionDisabledForResolution。
 */
export function isRoomFunctionAvailable(roomId: string, room: GameRoom): boolean {
  return !isRoomFunctionDisabledForResolution(roomId, room);
}
