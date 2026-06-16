// 地图「逻辑连接」草稿。地图编辑器 /dev/map-editor 编辑的就是这份数据。
//
// 【重要】只有连接数据负责"地图怎么走"（移动/步数规则）。坐标（mapLayout.ts）只负责显示。
//
// 初始草稿由现有规则图结构 mapGraph.ts 的边派生而来（单一来源、避免重复）：
//   HORIZONTAL → adjacent（普通相邻，双向）
//   STAIRS     → stairs  （楼梯，双向）
//   BRIDGES    → bridge  （廊桥，双向）
//   TRASH_CHUTE→ pipe    （B105→B503 垃圾管道，单向）
//   HELI       → helicopter（202→各目标，单向，下一轮生效）
// 传送室 B403「→任意普通房间」是规则级特殊移动（一对多），不在此列为成对连接，
//   编辑器保留 teleport 类型供人工标注；如需可手动添加。
//
// 编辑器中可对每条连接修改类型/是否双向/needReview/备注，并导出 JSON。
// 不确定的连接请标记 needReview，不要硬编。

import {
  HORIZONTAL,
  STAIRS,
  BRIDGES,
  TRASH_CHUTE,
  HELIPAD_ROOM,
  HELI_TARGETS,
} from "./mapGraph";
import mapDraft from "./mapDraft.json";

export type RoomConnectionType =
  | "adjacent" // 普通相邻
  | "stairs" // 楼梯
  | "bridge" // 廊桥
  | "pipe" // 管道（如 B105 → B503）
  | "teleport" // 传送
  | "helicopter" // 停机坪直升机
  | "special"; // 其他特殊连接

export interface RoomConnection {
  id: string;
  from: string;
  to: string;
  type: RoomConnectionType;
  bidirectional: boolean;
  needReview?: boolean;
  note?: string;
}

export const CONNECTION_TYPE_LABEL: Record<RoomConnectionType, string> = {
  adjacent: "普通相邻",
  stairs: "楼梯",
  bridge: "廊桥",
  pipe: "管道",
  teleport: "传送",
  helicopter: "直升机",
  special: "特殊",
};

/** 稳定连接 id：双向用排序后端点，单向保留方向。 */
export function makeConnectionId(
  from: string,
  to: string,
  type: RoomConnectionType,
  bidirectional: boolean
): string {
  const ends = bidirectional ? [from, to].sort() : [from, to];
  return `${type}:${ends[0]}-${ends[1]}${bidirectional ? "" : ":dir"}`;
}

/**
 * 由规则图结构派生的初始连接（仅作为 mapDraft.json 缺失时的回退/参考）。
 * 正式默认见下方 DEFAULT_MAP_CONNECTIONS（优先取人工校准的 mapDraft.json）。
 */
function build(): RoomConnection[] {
  const out: RoomConnection[] = [];
  const push = (
    from: string,
    to: string,
    type: RoomConnectionType,
    bidirectional: boolean,
    extra?: Partial<RoomConnection>
  ) => {
    out.push({
      id: makeConnectionId(from, to, type, bidirectional),
      from,
      to,
      type,
      bidirectional,
      ...extra,
    });
  };

  for (const [a, b] of HORIZONTAL) push(a, b, "adjacent", true);
  for (const [a, b] of STAIRS) push(a, b, "stairs", true);
  for (const [a, b] of BRIDGES) push(a, b, "bridge", true);

  push(TRASH_CHUTE.from, TRASH_CHUTE.to, "pipe", false, {
    note: "回收站垃圾管道，单向，消耗 1 步",
  });
  for (const t of HELI_TARGETS) {
    push(HELIPAD_ROOM, t, "helicopter", false, {
      note: "停机坪直升机目标（下一轮消耗 1 步）",
    });
  }

  return out;
}

/** 由规则图结构派生的连接（参考/回退）。 */
export const GENERATED_CONNECTIONS: RoomConnection[] = build();

/** 默认连接：优先取人工校准的 mapDraft.json，为空时回退到派生连接。 */
export const DEFAULT_MAP_CONNECTIONS: RoomConnection[] =
  Array.isArray(mapDraft.connections) && mapDraft.connections.length > 0
    ? (mapDraft.connections as RoomConnection[])
    : GENERATED_CONNECTIONS;
