// 毒气房间判定。来源：规则手册 11.3-11.5。

import { getRoom } from "./config/rooms";

/**
 * 判定某房间在给定毒气楼层下是否受毒气影响。
 * - 已被控制室解除毒气的房间：否（规则 11.4）；
 * - B501 大仓库：仅当 B4 与 B5 都成为毒气楼层时才受影响（规则 11.5）；
 * - 其余房间：所属楼层在毒气楼层列表中即受影响。
 */
export function isRoomGassed(
  roomId: string,
  gasFloors: string[],
  clearedGasRooms: string[] = []
): boolean {
  if (clearedGasRooms.includes(roomId)) return false;
  const room = getRoom(roomId);
  if (!room) return false;

  if (roomId === "B501") {
    return gasFloors.includes("B4") && gasFloors.includes("B5");
  }
  return gasFloors.includes(room.floor);
}
