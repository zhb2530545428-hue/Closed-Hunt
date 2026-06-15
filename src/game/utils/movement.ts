// 移动路径工具（纯函数）。来源：规则手册 4 移动规则、7.3 经过型效果。
// 所有地图规则集中在 config/mapGraph.ts 与本文件，不在 UI 组件中硬编码。

import type { Player, PlayerStatus } from "../types";
import {
  MAP_NODES,
  getNode,
  getNeighbors,
  verticallyAligned,
  normalRoomIds,
  TRASH_CHUTE,
  PORTAL_ROOM,
  HELIPAD_ROOM,
  HELI_TARGETS,
} from "../config/mapGraph";

export type MoveType = "normal" | "rope" | "shadow" | "helicopter" | "trash_chute" | "portal";

export interface MoveContext {
  fromRoomId: string;
  speed: number;
  status: PlayerStatus;
  /** 存活且持有绳索：可不经楼梯上下楼 */
  hasRope: boolean;
  /** 直升机资格：本轮起点为 202 停机坪（上一轮停留所致） */
  heliEligible: boolean;
}

export interface ReachableRoom {
  roomId: string;
  distance: number;
  path: string[];
  /** 路径上用到的特殊移动 */
  specialMoves: MoveType[];
  warnings: string[];
}

interface Edge {
  to: string;
  type: MoveType;
}

const LASER_ROOM = "102";

/** 由玩家构建移动上下文 */
export function buildMoveContext(player: Player): MoveContext {
  return {
    fromRoomId: player.location ?? "",
    speed: player.speed,
    status: player.status,
    hasRope: player.status === "alive" && player.inventory.includes("rope"),
    heliEligible: player.location === HELIPAD_ROOM,
  };
}

/** 某房间在给定上下文下可一步到达的边 */
function edgesFrom(u: string, ctx: MoveContext): Edge[] {
  const edges: Edge[] = [];
  for (const n of getNeighbors(u)) edges.push({ to: n, type: "normal" });

  // 绳索 / 暗影：竖向对齐房间不经楼梯上下楼（每跨 1 层 1 步）
  if (ctx.status === "shadow" || ctx.hasRope) {
    const type: MoveType = ctx.status === "shadow" ? "shadow" : "rope";
    for (const id of Object.keys(MAP_NODES)) {
      if (verticallyAligned(u, id)) edges.push({ to: id, type });
    }
  }

  // 回收站 → 垃圾场，单向
  if (u === TRASH_CHUTE.from) edges.push({ to: TRASH_CHUTE.to, type: "trash_chute" });

  // 传送室 → 任意普通房间
  if (u === PORTAL_ROOM) {
    for (const id of normalRoomIds()) if (id !== u) edges.push({ to: id, type: "portal" });
  }

  // 直升机：仅当本轮起点为停机坪
  if (ctx.heliEligible && u === HELIPAD_ROOM && u === ctx.fromRoomId) {
    for (const id of HELI_TARGETS) edges.push({ to: id, type: "helicopter" });
  }

  return edges;
}

interface Visit {
  dist: number;
  path: string[];
  specialMoves: MoveType[];
}

/** 统一 BFS（每条边消耗 1 步），返回从起点出发各房间的最短到达信息。 */
function bfs(ctx: MoveContext, maxSteps: number): Map<string, Visit> {
  const visited = new Map<string, Visit>();
  if (!getNode(ctx.fromRoomId)) return visited;
  visited.set(ctx.fromRoomId, { dist: 0, path: [ctx.fromRoomId], specialMoves: [] });
  const queue: string[] = [ctx.fromRoomId];

  while (queue.length) {
    const u = queue.shift()!;
    const cur = visited.get(u)!;
    if (cur.dist >= maxSteps) continue;
    for (const edge of edgesFrom(u, ctx)) {
      if (visited.has(edge.to)) continue; // BFS：首次到达即最短
      const specialMoves =
        edge.type === "normal" ? cur.specialMoves : [...cur.specialMoves, edge.type];
      visited.set(edge.to, { dist: cur.dist + 1, path: [...cur.path, edge.to], specialMoves });
      queue.push(edge.to);
    }
  }
  return visited;
}

/** 路径经过的激光室伤害提示（存活玩家经过/停留 102） */
function laserWarnings(path: string[], status: PlayerStatus): string[] {
  if (status === "shadow") return [];
  // 起点除外：路径中（含终点）出现 102 即触发
  if (path.slice(1).includes(LASER_ROOM)) return ["经过/停留 102 激光室，确认后立即扣 1 点生命"];
  return [];
}

function specialWarnings(specialMoves: MoveType[]): string[] {
  const w: string[] = [];
  if (specialMoves.includes("helicopter")) w.push("使用直升机");
  if (specialMoves.includes("portal")) w.push("使用 B403 传送室");
  if (specialMoves.includes("trash_chute")) w.push("使用 B105 垃圾管道（单向至 B503）");
  if (specialMoves.includes("rope")) w.push("使用绳索上下楼");
  if (specialMoves.includes("shadow")) w.push("暗影上下楼");
  return w;
}

/** 本轮可达房间（不含起点；存活玩家排除原地停留）。 */
export function getReachableRooms(ctx: MoveContext): ReachableRoom[] {
  const visited = bfs(ctx, ctx.speed);
  const out: ReachableRoom[] = [];
  for (const [roomId, v] of visited) {
    if (roomId === ctx.fromRoomId) continue;
    out.push({
      roomId,
      distance: v.dist,
      path: v.path,
      specialMoves: v.specialMoves,
      warnings: [...laserWarnings(v.path, ctx.status), ...specialWarnings(v.specialMoves)],
    });
  }
  return out.sort((a, b) => a.distance - b.distance || a.roomId.localeCompare(b.roomId));
}

/** 最短路径（忽略速度限制）。返回 path 或 null。 */
export function findShortestPath(ctx: MoveContext, toRoomId: string): string[] | null {
  const visited = bfs(ctx, Number.POSITIVE_INFINITY);
  return visited.get(toRoomId)?.path ?? null;
}

export interface MovePreview {
  ok: boolean;
  reason?: string;
  toRoom: string;
  steps: number;
  path: string[];
  specialMoves: MoveType[];
  passesLaser: boolean;
  warnings: string[];
}

/** 校验移动是否合法，返回预览。 */
export function validateMove(ctx: MoveContext, toRoomId: string): MovePreview {
  const empty: MovePreview = { ok: false, toRoom: toRoomId, steps: 0, path: [], specialMoves: [], passesLaser: false, warnings: [] };

  if (!getNode(ctx.fromRoomId)) return { ...empty, reason: "起点房间无效。" };
  if (!getNode(toRoomId)) return { ...empty, reason: "目标房间不存在。" };
  if (toRoomId === ctx.fromRoomId) return { ...empty, reason: "每轮必须移动，不能原地停留。" };

  const reachable = bfs(ctx, ctx.speed);
  const hit = reachable.get(toRoomId);
  if (!hit) {
    const all = bfs(ctx, Number.POSITIVE_INFINITY).get(toRoomId);
    return { ...empty, reason: all ? `超出速度范围（需 ${all.dist} 步，速度 ${ctx.speed}）。` : "该房间无法到达（无连接路径）。" };
  }

  return buildPreviewFromVisit(toRoomId, hit, ctx);
}

/** 生成移动预览（已知可达）。 */
export function getMovePreview(ctx: MoveContext, toRoomId: string): MovePreview {
  return validateMove(ctx, toRoomId);
}

function buildPreviewFromVisit(
  toRoomId: string,
  hit: Visit,
  ctx: MoveContext
): MovePreview {
  const passesLaser = ctx.status === "alive" && hit.path.slice(1).includes(LASER_ROOM);
  return {
    ok: true,
    toRoom: toRoomId,
    steps: hit.dist,
    path: hit.path,
    specialMoves: hit.specialMoves,
    passesLaser,
    warnings: [...laserWarnings(hit.path, ctx.status), ...specialWarnings(hit.specialMoves)],
  };
}

/** 路径是否触发激光（存活玩家经过/停留 102） */
export function pathTriggersLaser(path: string[] | undefined, status: PlayerStatus): boolean {
  if (!path || status === "shadow") return false;
  return path.slice(1).includes(LASER_ROOM);
}
