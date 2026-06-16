// 地图展示坐标（display-only，v1.0.1 §2）。
// 归一化坐标（0..1，相对地图图片宽/高），仅用于在 禁闭逃杀_地图.png 上叠加房间热区与高亮，
// 【不参与任何规则/步数计算】——步数与可达性一律由 mapGraph.ts + utils/movement.ts 的图结构计算。
//
// 这里的坐标依据地图 png 的「列(col) × 楼层(floorOrder)」网格估算（见 mapGraph.ts 的 COL 与 FLOORS），
// 为规整网格的初版近似，可能与图片实际方块位置有偏差。请用 /dev/map-checker 叠加核对后手工微调，
// 偏差较大的房间已记入 MAP_REVIEW.md。修改坐标不会影响规则。

import { MAP_NODES } from "./mapGraph";
import { ROOMS } from "./rooms";

export interface RoomCoord {
  roomId: string;
  x: number; // 左上角 x（0..1）
  y: number; // 左上角 y（0..1）
  w: number; // 宽（0..1）
  h: number; // 高（0..1）
  cx: number; // 中心 x
  cy: number; // 中心 y
}

// 各列中心 x（0..4 左楼栋，5 中央竖井，6..8 右楼栋）。
const COL_X: Record<number, number> = {
  0: 0.075,
  1: 0.17,
  2: 0.265,
  3: 0.36,
  4: 0.455,
  5: 0.55, // 中央竖井（廊桥所在），一般无房间
  6: 0.65,
  7: 0.745,
  8: 0.84,
};

const CELL_W = 0.085;
const CELL_H = 0.07;
const TOP = 0.04; // 顶部留白（2F）
const ROW_H = 0.104; // 楼层行高

function build(): Record<string, RoomCoord> {
  const out: Record<string, RoomCoord> = {};
  for (const r of ROOMS) {
    const node = MAP_NODES[r.id];
    const cxCol = COL_X[node?.col ?? 5] ?? 0.5;
    const x = cxCol - CELL_W / 2;
    const y = TOP + (node?.floorOrder ?? 0) * ROW_H;
    out[r.id] = {
      roomId: r.id,
      x,
      y,
      w: CELL_W,
      h: CELL_H,
      cx: x + CELL_W / 2,
      cy: y + CELL_H / 2,
    };
  }
  return out;
}

export const ROOM_COORDS: Record<string, RoomCoord> = build();

export function getRoomCoord(id: string): RoomCoord | undefined {
  return ROOM_COORDS[id];
}
