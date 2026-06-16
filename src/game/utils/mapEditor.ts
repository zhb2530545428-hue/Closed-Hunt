// 地图编辑器纯函数：校验 + 基于"逻辑连接"的最短路径。
// 这些是开发工具逻辑，但同样遵守"规则不写死在 UI"：校验/寻路在此，页面只负责交互与展示。
// 注意：此处寻路用的是【编辑器草稿连接】（mapConnections），便于校验编辑结果；
//      正式游戏的步数仍由 mapGraph + utils/movement 计算，两者解耦。

import { ROOMS } from "../config/rooms";
import type { RoomLayout } from "../config/mapLayout";
import type { RoomConnection, RoomConnectionType } from "../config/mapConnections";

export interface MapIssue {
  level: "error" | "warn";
  message: string;
}

/** 邻接表：双向连接两端互加，单向只加 from→to。 */
export function buildAdjacency(
  connections: RoomConnection[]
): Map<string, { to: string; type: RoomConnectionType }[]> {
  const adj = new Map<string, { to: string; type: RoomConnectionType }[]>();
  const add = (a: string, b: string, type: RoomConnectionType) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, type });
  };
  for (const c of connections) {
    add(c.from, c.to, c.type);
    if (c.bidirectional) add(c.to, c.from, c.type);
  }
  return adj;
}

export interface PathResult {
  path: string[];
  steps: number;
  edgeTypes: RoomConnectionType[];
}

/** 编辑器连接图上的最短路径（每条连接 1 步），不可达返回 null。 */
export function shortestPath(
  connections: RoomConnection[],
  from: string,
  to: string
): PathResult | null {
  if (from === to) return { path: [from], steps: 0, edgeTypes: [] };
  const adj = buildAdjacency(connections);
  const prev = new Map<string, { from: string; type: RoomConnectionType }>();
  const visited = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length) {
    const u = queue.shift()!;
    for (const e of adj.get(u) ?? []) {
      if (visited.has(e.to)) continue;
      visited.add(e.to);
      prev.set(e.to, { from: u, type: e.type });
      if (e.to === to) {
        const path: string[] = [to];
        const edgeTypes: RoomConnectionType[] = [];
        let cur = to;
        while (cur !== from) {
          const p = prev.get(cur)!;
          edgeTypes.unshift(p.type);
          path.unshift(p.from);
          cur = p.from;
        }
        return { path, steps: path.length - 1, edgeTypes };
      }
      queue.push(e.to);
    }
  }
  return null;
}

/** 地图数据校验（开发用）。返回问题列表。 */
export function validateMapData(
  layout: RoomLayout[],
  connections: RoomConnection[]
): MapIssue[] {
  const issues: MapIssue[] = [];
  const ruleIds = new Set(ROOMS.map((r) => r.id));
  const layoutIds = new Set(layout.map((l) => l.id));

  // 规则手册有、布局缺失
  for (const id of ruleIds) {
    if (!layoutIds.has(id)) issues.push({ level: "error", message: `规则房间缺失布局：${id}` });
  }
  // 布局有、规则手册无
  for (const id of layoutIds) {
    if (!ruleIds.has(id)) issues.push({ level: "error", message: `布局存在未知房间：${id}` });
  }

  // 连接指向不存在房间
  for (const c of connections) {
    if (!ruleIds.has(c.from)) issues.push({ level: "error", message: `连接 ${c.id} 起点不存在：${c.from}` });
    if (!ruleIds.has(c.to)) issues.push({ level: "error", message: `连接 ${c.id} 终点不存在：${c.to}` });
    if (c.from === c.to) issues.push({ level: "error", message: `连接 ${c.id} 自连接：${c.from}` });
  }

  // 重复连接（同一对端点 + 类型，忽略方向）
  const seen = new Map<string, number>();
  for (const c of connections) {
    const key = `${c.type}:${[c.from, c.to].sort().join("-")}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) {
    if (n > 1) issues.push({ level: "warn", message: `重复连接（${n} 条）：${key}` });
  }

  // 孤立房间（无任何连接）
  const connected = new Set<string>();
  for (const c of connections) {
    connected.add(c.from);
    connected.add(c.to);
  }
  for (const id of ruleIds) {
    if (!connected.has(id)) issues.push({ level: "warn", message: `孤立房间（无连接）：${id}` });
  }

  // needReview
  for (const c of connections) {
    if (c.needReview) issues.push({ level: "warn", message: `待人工确认连接：${c.from}↔${c.to}（${c.type}）${c.note ? `｜${c.note}` : ""}` });
  }

  // 单向但无备注
  for (const c of connections) {
    if (!c.bidirectional && !c.note?.trim()) {
      issues.push({ level: "warn", message: `单向连接缺备注：${c.from}→${c.to}（${c.type}）` });
    }
  }

  return issues;
}
