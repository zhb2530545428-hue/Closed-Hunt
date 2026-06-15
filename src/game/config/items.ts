// 道具配置。来源：规则手册 15.1 道具表、9.2 武器加成。
// v0.1 仅用于展示与库存记录；战斗/使用结算留待 v0.2。

export type ItemType =
  | "consumable"
  | "weapon"
  | "equipment"
  | "active"
  | "junk";

export interface ItemConfig {
  id: string;
  name: string;
  type: ItemType;
  effect: string;
  /** 战斗力加成（仅武器） */
  combatBonus?: number;
  /** 是否属于「枪」（手枪 / 霰弹枪） */
  isGun?: boolean;
}

export const ITEMS: ItemConfig[] = [
  { id: "water", name: "水", type: "consumable", effect: "第 2 轮起水粮步骤可上交抵抗饥饿。" },
  { id: "food", name: "粮食", type: "consumable", effect: "第 2 轮起水粮步骤可上交抵抗饥饿。" },
  { id: "pill", name: "药片", type: "consumable", effect: "生命值 +2，不超过上限。" },
  { id: "adrenaline", name: "肾上腺素", type: "consumable", effect: "下一轮速度变为 10；下一轮伤害最多降至 1 不死亡。" },
  { id: "wine", name: "酒", type: "consumable", effect: "公开使用，掷骰并立即执行结果。" },
  { id: "gold", name: "金条", type: "consumable", effect: "抽卡时额外选 1 张（不能选金条）；最终结算 1 金条兑 1 生命。" },
  { id: "knife", name: "刀", type: "weapon", effect: "战斗力 +2。", combatBonus: 2, isGun: false },
  { id: "pistol", name: "手枪", type: "weapon", effect: "战斗力 +2；属于枪，对无枪玩家压制。", combatBonus: 2, isGun: true },
  { id: "shotgun", name: "霰弹枪", type: "weapon", effect: "战斗力 +4；属于枪，对无枪玩家压制。", combatBonus: 4, isGun: true },
  { id: "rope", name: "绳索", type: "equipment", effect: "不通过楼梯上下楼，每跨 1 层消耗 1 步。" },
  { id: "gasmask", name: "防毒面具", type: "equipment", effect: "不受毒气伤害。" },
  { id: "rocket", name: "火箭筒", type: "active", effect: "每轮选 1 房间袭击，结算时该房间存活玩家 -4。" },
  { id: "pocket", name: "次元口袋", type: "equipment", effect: "持有者负重上限视为无限。" },
  { id: "recycler", name: "循环回收装置", type: "active", effect: "每轮可从已消耗道具堆随机抽 1 张（不超过负重）。" },
  { id: "junk", name: "垃圾", type: "junk", effect: "没有任何效果。" },
];

export function getItem(id: string): ItemConfig | undefined {
  return ITEMS.find((i) => i.id === id);
}

export function getItemName(id: string): string {
  return getItem(id)?.name ?? id;
}
