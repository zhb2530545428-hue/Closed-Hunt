// 地图图结构配置。来源：禁闭逃杀_地图.png（房间相邻关系）+ 规则手册 4（移动规则）。
// 相邻关系为人工对照地图录入：同层相邻横向连通、楼梯竖向连通、中央廊桥跨楼栋连通。
// 仅录入地图上确实存在的连接，未连接房间不可直接移动。
//
// 注意：所有地图规则集中于此与 utils/movement.ts，不在 UI 组件中硬编码。

import { ROOMS, getRoom } from "./rooms";
import { FLOORS } from "./floors";

export interface MapNode {
  id: string;
  floor: string;
  /** 楼层顺序索引（2F=0 … B7=8），用于竖向相邻判定 */
  floorOrder: number;
  /** 列坐标：左楼栋 0-4，中央竖井=5（空），右楼栋 6-8。用于绳索/暗影竖向对齐 */
  col: number;
  name?: string;
  /** 普通房间（无功能名）。传送室目标只能是普通房间。 */
  isNormalRoom: boolean;
  isFunctionRoom: boolean;
  /** 可直接移动到的相邻房间（双向，含横向相邻、楼梯、廊桥） */
  neighbors: string[];
}

// 列坐标（对照地图横向位置）。
const COL: Record<string, number> = {
  // 2F
  "201": 2, "202": 7,
  // 1F
  "101": 0, "102": 2, "103": 7, "104": 8,
  // B1
  "B101": 0, "B102": 1, "B103": 2, "B104": 3, "B105": 4, "B106": 6, "B107": 7,
  // B2
  "B201": 0, "B202": 1, "B203": 2, "B204": 3, "B205": 4, "B206": 7,
  // B3
  "B301": 0, "B302": 1, "B303": 2, "B304": 3, "B305": 4, "B306": 6, "B307": 7, "B308": 8,
  // B4
  "B401": 2, "B402": 3, "B403": 6, "B404": 7, "B405": 8,
  // B5
  "B501": 0, "B502": 2, "B503": 3, "B504": 6, "B505": 7,
  // B6
  "B601": 1, "B602": 2, "B603": 3, "B604": 6,
  // B7
  "B701": 2,
};

// 无向边（可直接移动）。分三类，便于核对。
// 导出供地图编辑器（mapConnections.ts）派生带类型的连接草稿；此处仍是规则唯一来源。
//
// 注：以下三类连接已由地图编辑器 /dev/map-editor 对照 禁闭逃杀_地图.png 人工校准并回写
// （草稿见 config/mapDraft.json）。传送（B403→任意普通房间）、直升机、垃圾管道为规则级特殊
// 移动，仍由下方常量 PORTAL_ROOM / HELI_TARGETS / TRASH_CHUTE 表达（与编辑器草稿等价）。
export const HORIZONTAL: [string, string][] = [
  ["103", "104"],
  ["B101", "B102"], ["B102", "B103"], ["B103", "B104"], ["B104", "B105"], ["B106", "B107"],
  ["B201", "B202"], ["B202", "B203"], ["B203", "B204"], ["B204", "B205"],
  ["B301", "B302"], ["B302", "B303"], ["B303", "B304"], ["B304", "B305"], ["B306", "B307"], ["B307", "B308"],
  ["B401", "B402"], ["B403", "B404"], ["B404", "B405"],
  ["B501", "B502"], ["B502", "B503"], ["B504", "B505"],
  ["B601", "B602"], ["B602", "B603"], ["B603", "B604"],
];

// 楼梯（竖向，对照地图阶梯，已人工校准）。
export const STAIRS: [string, string][] = [
  // 左楼栋
  ["201", "102"], ["101", "B102"], ["102", "B104"],
  ["B102", "B201"], ["B204", "B304"], ["B204", "B305"], ["B105", "B205"],
  ["B304", "B401"], ["B402", "B503"], ["B501", "B601"], ["B602", "B701"],
  // 右楼栋
  ["202", "104"], ["103", "B106"], ["B106", "B206"], ["B206", "B308"],
  ["B307", "B404"], ["B405", "B505"], ["B504", "B604"],
];

// 廊桥（跨中央竖井连接左右楼栋）。
export const BRIDGES: [string, string][] = [
  ["B105", "B106"],
  ["B305", "B306"],
];

// —— 特殊移动配置（规则 4.4、14.1） ——

/** B105 回收站 → B503 垃圾场，单向，消耗 1 步 */
export const TRASH_CHUTE = { from: "B105", to: "B503" } as const;

/** B403 传送室：消耗 1 步传送至任意普通房间 */
export const PORTAL_ROOM = "B403";

/** 202 停机坪直升机：下一轮消耗 1 步前往以下房间之一 */
export const HELIPAD_ROOM = "202";
export const HELI_TARGETS: string[] = ["B101", "101", "B103", "201", "B105"];

// —— 构建图 ——

function buildNodes(): Record<string, MapNode> {
  const floorOrder: Record<string, number> = {};
  FLOORS.forEach((f, i) => (floorOrder[f.id] = i));

  const nodes: Record<string, MapNode> = {};
  for (const r of ROOMS) {
    nodes[r.id] = {
      id: r.id,
      floor: r.floor,
      floorOrder: floorOrder[r.floor] ?? 0,
      col: COL[r.id] ?? 5,
      name: r.name,
      isNormalRoom: !r.name,
      isFunctionRoom: !!r.name,
      neighbors: [],
    };
  }
  const link = (a: string, b: string) => {
    if (!nodes[a] || !nodes[b]) return;
    if (!nodes[a].neighbors.includes(b)) nodes[a].neighbors.push(b);
    if (!nodes[b].neighbors.includes(a)) nodes[b].neighbors.push(a);
  };
  for (const [a, b] of [...HORIZONTAL, ...STAIRS, ...BRIDGES]) link(a, b);
  return nodes;
}

export const MAP_NODES: Record<string, MapNode> = buildNodes();

export function getNode(id: string): MapNode | undefined {
  return MAP_NODES[id];
}

export function getNeighbors(id: string): string[] {
  return MAP_NODES[id]?.neighbors ?? [];
}

export function isNormalRoom(id: string): boolean {
  return !!MAP_NODES[id]?.isNormalRoom;
}

export function areAdjacent(a: string, b: string): boolean {
  return getNeighbors(a).includes(b);
}

/** 竖向对齐（同列、相邻楼层）：用于绳索 / 暗影不经楼梯上下楼 */
export function verticallyAligned(a: string, b: string): boolean {
  const na = MAP_NODES[a];
  const nb = MAP_NODES[b];
  if (!na || !nb) return false;
  return na.col === nb.col && na.col !== 5 && Math.abs(na.floorOrder - nb.floorOrder) === 1;
}

/** 全部普通房间 id（传送目标） */
export function normalRoomIds(): string[] {
  return ROOMS.filter((r) => !r.name).map((r) => r.id);
}

/**
 * 地图图结构校验（开发期使用）：
 * - 所有规则房间都存在；
 * - 邻接房间 id 都能找到；
 * - 邻接关系双向。
 */
export function validateMapGraph(): string[] {
  const errors: string[] = [];
  for (const r of ROOMS) {
    if (!MAP_NODES[r.id]) errors.push(`缺少房间节点：${r.id}`);
  }
  for (const node of Object.values(MAP_NODES)) {
    for (const n of node.neighbors) {
      if (!MAP_NODES[n]) errors.push(`${node.id} 的邻居 ${n} 不存在`);
      else if (!MAP_NODES[n].neighbors.includes(node.id)) {
        errors.push(`邻接非双向：${node.id} → ${n}`);
      }
    }
    if (!getRoom(node.id)) errors.push(`节点 ${node.id} 不在 ROOMS 配置中`);
  }
  return errors;
}
