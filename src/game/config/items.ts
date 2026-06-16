// 道具配置。来源：规则手册 15.1 道具表、9.2 武器加成。

export type ItemType =
  | "consumable"
  | "weapon"
  | "equipment"
  | "active"
  | "junk"
  | "settlement";

export interface ItemConfig {
  id: string;
  name: string;
  type: ItemType;
  /** 占用负重，默认 1。次元口袋本身仍占 1。 */
  weight: number;
  /** 武器战斗力加成 */
  weaponBonus?: number;
  /** 是否属于「枪」（手枪 / 霰弹枪） */
  isGun?: boolean;
  description: string;
  timing?: string;
}

export const ITEMS: ItemConfig[] = [
  { id: "water", name: "水", type: "consumable", weight: 1, description: "第 2 轮起水粮步骤可上交抵抗饥饿。", timing: "结算阶段水粮步骤" },
  { id: "food", name: "粮食", type: "consumable", weight: 1, description: "第 2 轮起水粮步骤可上交抵抗饥饿。", timing: "结算阶段水粮步骤" },
  { id: "pill", name: "药片", type: "consumable", weight: 1, description: "生命值 +2，不超过上限。", timing: "结算阶段道具回血/状态步骤" },
  { id: "adrenaline", name: "肾上腺素", type: "consumable", weight: 1, description: "公开使用，下一轮生效：速度变 10；下一轮伤害最多降至 1 不死亡。", timing: "结算阶段使用，下一轮生效" },
  { id: "juice", name: "果汁", type: "consumable", weight: 1, description: "公开使用，掷骰并立即执行结果。", timing: "结算阶段道具回血/状态步骤" },
  { id: "gold", name: "金条", type: "settlement", weight: 1, description: "抽卡时额外选 1 张（不能选金条）；最终结算 1 金条兑 1 生命。", timing: "抽卡时 / 最终结算" },
  { id: "knife", name: "刀", type: "weapon", weight: 1, weaponBonus: 2, isGun: false, description: "战斗力 +2。", timing: "持有生效" },
  { id: "pistol", name: "手枪", type: "weapon", weight: 1, weaponBonus: 2, isGun: true, description: "战斗力 +2；属于枪，对无枪玩家压制。", timing: "持有生效" },
  { id: "shotgun", name: "霰弹枪", type: "weapon", weight: 1, weaponBonus: 4, isGun: true, description: "战斗力 +4；属于枪，对无枪玩家压制。", timing: "持有生效" },
  { id: "rope", name: "绳索", type: "equipment", weight: 1, description: "不通过楼梯上下楼，每跨 1 层消耗 1 步。", timing: "持有生效" },
  { id: "gasmask", name: "防毒面具", type: "equipment", weight: 1, description: "不受毒气伤害。", timing: "持有生效" },
  { id: "rocket", name: "火箭筒", type: "active", weight: 1, description: "每轮选 1 房间袭击，结算时该房间存活玩家 -4。", timing: "行动阶段选择，结算阶段生效" },
  { id: "pocket", name: "次元口袋", type: "equipment", weight: 1, description: "持有者负重上限视为无限（本身仍占 1 张道具卡）。", timing: "持有生效" },
  { id: "recycler", name: "循环回收装置", type: "active", weight: 1, description: "每轮可从已消耗道具堆随机抽 1 张（不超过负重）。", timing: "行动阶段" },
  { id: "junk", name: "垃圾", type: "junk", weight: 1, description: "没有任何效果。", timing: "无" },
];

const ITEM_MAP: Record<string, ItemConfig> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

/**
 * 旧 itemId 兼容映射（v1.0.1：「酒」统一为「果汁」）。
 * 用于读档迁移与显示兜底，保证旧存档中的 wine / 酒 不报错。
 */
export const ITEM_ID_ALIASES: Record<string, string> = {
  wine: "juice",
  alcohol: "juice",
  liquor: "juice",
  beer: "juice",
  酒: "juice",
};

/** 归一化 itemId（应用旧别名映射）。 */
export function normalizeItemId(id: string): string {
  return ITEM_ID_ALIASES[id] ?? id;
}

export function getItem(id: string): ItemConfig | undefined {
  return ITEM_MAP[id] ?? ITEM_MAP[normalizeItemId(id)];
}

export function getItemName(id: string): string {
  return ITEM_MAP[id]?.name ?? ITEM_MAP[normalizeItemId(id)]?.name ?? id;
}

export function isGunItem(id: string): boolean {
  return !!ITEM_MAP[id]?.isGun;
}

export function isWeaponItem(id: string): boolean {
  return ITEM_MAP[id]?.type === "weapon";
}

export function isJunkItem(id: string): boolean {
  return ITEM_MAP[id]?.type === "junk";
}

export function weaponBonusOf(id: string): number {
  return ITEM_MAP[id]?.weaponBonus ?? 0;
}
