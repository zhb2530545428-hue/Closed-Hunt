// 楼层配置。来源：规则手册 4.1 地图房间表。
// 毒气投票以「楼层」为单位（规则 7.7 / 11）。

export interface FloorConfig {
  id: string;
  label: string;
  /** 排序用，从上到下 */
  order: number;
}

export const FLOORS: FloorConfig[] = [
  { id: "2F", label: "2F 二楼", order: 0 },
  { id: "1F", label: "1F 一楼", order: 1 },
  { id: "B1", label: "B1 地下一层", order: 2 },
  { id: "B2", label: "B2 地下二层", order: 3 },
  { id: "B3", label: "B3 地下三层", order: 4 },
  { id: "B4", label: "B4 地下四层", order: 5 },
  { id: "B5", label: "B5 地下五层", order: 6 },
  { id: "B6", label: "B6 地下六层", order: 7 },
  { id: "B7", label: "B7 地下七层", order: 8 },
];

export const FLOOR_IDS = FLOORS.map((f) => f.id);

export function getFloorLabel(id: string): string {
  return FLOORS.find((f) => f.id === id)?.label ?? id;
}
