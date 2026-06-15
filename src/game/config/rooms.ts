// 房间配置。来源：规则手册 4.1 地图房间表、14.1 房间功能表、2.4 出生房间。
// 仅记录静态属性；房间功能的详细规则在 roomFunctions.ts。

export interface RoomConfig {
  id: string;
  floor: string;
  /** 功能性名称，如「基因库」；普通房间为空 */
  name?: string;
  /** 是否为红色出生房间 */
  isSpawn?: boolean;
}

export const ROOMS: RoomConfig[] = [
  // 2F
  { id: "201", floor: "2F", name: "基因库" },
  { id: "202", floor: "2F", name: "停机坪" },
  // 1F
  { id: "101", floor: "1F", name: "水塔" },
  { id: "102", floor: "1F", name: "激光室" },
  { id: "103", floor: "1F", isSpawn: true },
  { id: "104", floor: "1F" },
  // B1
  { id: "B101", floor: "B1", name: "控制室" },
  { id: "B102", floor: "B1" },
  { id: "B103", floor: "B1", isSpawn: true },
  { id: "B104", floor: "B1" },
  { id: "B105", floor: "B1", name: "回收站" },
  { id: "B106", floor: "B1" },
  { id: "B107", floor: "B1", name: "武器库" },
  // B2
  { id: "B201", floor: "B2" },
  { id: "B202", floor: "B2", name: "手术室" },
  { id: "B203", floor: "B2" },
  { id: "B204", floor: "B2", name: "餐厅" },
  { id: "B205", floor: "B2" },
  { id: "B206", floor: "B2", name: "金库" },
  // B3
  { id: "B301", floor: "B3", name: "药房" },
  { id: "B302", floor: "B3" },
  { id: "B303", floor: "B3", isSpawn: true },
  { id: "B304", floor: "B3", name: "操作室" },
  { id: "B305", floor: "B3" },
  { id: "B306", floor: "B3" },
  { id: "B307", floor: "B3", isSpawn: true },
  { id: "B308", floor: "B3" },
  // B4
  { id: "B401", floor: "B4" },
  { id: "B402", floor: "B4", isSpawn: true },
  { id: "B403", floor: "B4", name: "传送室" },
  { id: "B404", floor: "B4" },
  { id: "B405", floor: "B4" },
  // B5
  { id: "B501", floor: "B5", name: "大仓库" },
  { id: "B502", floor: "B5" },
  { id: "B503", floor: "B5", name: "垃圾场" },
  { id: "B504", floor: "B5" },
  { id: "B505", floor: "B5", name: "粮仓" },
  // B6
  { id: "B601", floor: "B6", name: "酒窖" },
  { id: "B602", floor: "B6" },
  { id: "B603", floor: "B6", isSpawn: true },
  { id: "B604", floor: "B6" },
  // B7
  { id: "B701", floor: "B7", name: "停尸间" },
];

export const ROOM_IDS = ROOMS.map((r) => r.id);

export function getRoom(id: string): RoomConfig | undefined {
  return ROOMS.find((r) => r.id === id);
}

/** 房间显示名：有功能名显示「103」或「201 基因库」 */
export function getRoomLabel(id: string): string {
  const r = getRoom(id);
  if (!r) return id;
  return r.name ? `${r.id} ${r.name}` : r.id;
}

/** 按楼层分组，供下拉框分组显示 */
export function roomsByFloor(): { floor: string; rooms: RoomConfig[] }[] {
  const map = new Map<string, RoomConfig[]>();
  for (const r of ROOMS) {
    if (!map.has(r.floor)) map.set(r.floor, []);
    map.get(r.floor)!.push(r);
  }
  return Array.from(map.entries()).map(([floor, rooms]) => ({ floor, rooms }));
}
