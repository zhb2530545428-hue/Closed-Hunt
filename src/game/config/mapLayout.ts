// 地图「显示布局」草稿（display-only）。地图编辑器 /dev/map-editor 的初始草稿来源。
//
// 【重要】坐标只负责"地图看起来长什么样"，不参与任何移动/步数规则。
// 移动规则一律由逻辑连接（mapConnections.ts → mapGraph.ts 图结构）决定。
//
// 默认草稿现已固化为人工校准版 mapDraft.json（编辑器导出后回写、纳入 git）。
// 若 mapDraft.json 缺少某房间，则回退用 mapCoords.ts（按"列×楼层"网格估算）补一个近似格子。

import { ROOMS } from "./rooms";
import { ROOM_COORDS } from "./mapCoords";
import mapDraft from "./mapDraft.json";

/** 编辑器画布逻辑尺寸（与参考底图 禁闭逃杀_地图.png 实际像素一致：1080×761）。 */
export const MAP_CANVAS = { width: 1080, height: 761 } as const;

/** 显示布局：房间矩形格子。坐标系为画布像素（左上角原点）。 */
export interface RoomLayout {
  id: string;
  name: string; // 房间功能名（无则为空串）
  floor: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 网格估算的回退坐标（仅当 mapDraft.json 缺该房间时使用）。 */
function gridLayout(id: string, name: string, floor: string): RoomLayout {
  const c = ROOM_COORDS[id];
  return {
    id,
    name,
    floor,
    x: Math.round((c?.x ?? 0.5) * MAP_CANVAS.width),
    y: Math.round((c?.y ?? 0.5) * MAP_CANVAS.height),
    width: Math.round((c?.w ?? 0.08) * MAP_CANVAS.width),
    height: Math.round((c?.h ?? 0.07) * MAP_CANVAS.height),
  };
}

/** 默认布局：以人工校准的 mapDraft.json 为准，名称/楼层始终取自 rooms.ts，缺失房间回退网格估算。 */
function buildDefaultLayout(): RoomLayout[] {
  const draftById = new Map((mapDraft.layout as RoomLayout[]).map((l) => [l.id, l]));
  return ROOMS.map((r) => {
    const name = r.name ?? "";
    const d = draftById.get(r.id);
    if (!d) return gridLayout(r.id, name, r.floor);
    return { id: r.id, name, floor: r.floor, x: d.x, y: d.y, width: d.width, height: d.height };
  });
}

export const DEFAULT_MAP_LAYOUT: RoomLayout[] = buildDefaultLayout();
