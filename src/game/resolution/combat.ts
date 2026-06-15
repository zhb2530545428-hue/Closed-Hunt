// 战斗 / 乱斗结算（纯函数）。来源：规则手册 9。

export interface Combatant {
  id: string;
  /** 战斗力 = 当前武力 + 武器加成 + 其他加成 */
  power: number;
  /** 是否持枪（手枪 / 霰弹枪） */
  hasGun: boolean;
}

export interface CombatOutcome {
  /** playerId -> 扣血量（正数表示损失生命） */
  damage: Record<string, number>;
  /** 是否触发枪械压制结算 */
  gunSuppression: boolean;
}

/**
 * 计算同房间参战玩家的扣血。来源：规则手册 9.3 / 9.4。
 * - 无枪：最高战斗力者不扣血，其余扣 (最高 - 自己)；
 * - 有枪：并列最高者不扣血；若最高全为无枪则按普通战斗；
 *   若最高含持枪玩家，则非最高的无枪玩家受最高持枪玩家完整战斗力伤害，
 *   非最高的持枪玩家按普通战斗（最高 - 自己）。
 */
export function computeCombatDamage(combatants: Combatant[]): CombatOutcome {
  const damage: Record<string, number> = {};
  for (const c of combatants) damage[c.id] = 0;
  if (combatants.length < 2) return { damage, gunSuppression: false };

  const maxPower = Math.max(...combatants.map((c) => c.power));
  const topPlayers = combatants.filter((c) => c.power === maxPower);
  const anyGun = combatants.some((c) => c.hasGun);
  const topHasGun = topPlayers.some((c) => c.hasGun);

  // 普通战斗：无枪，或最高战斗力者全为无枪（规则 9.4.3）
  if (!anyGun || !topHasGun) {
    for (const c of combatants) {
      if (c.power === maxPower) continue;
      damage[c.id] = maxPower - c.power;
    }
    return { damage, gunSuppression: false };
  }

  // 枪械压制：最高含持枪玩家（规则 9.4.4）。此时 maxPower 即最高持枪战斗力。
  for (const c of combatants) {
    if (c.power === maxPower) continue; // 并列最高不受伤害
    if (c.hasGun) {
      damage[c.id] = maxPower - c.power; // 持枪玩家之间按普通战斗
    } else {
      damage[c.id] = maxPower; // 非最高无枪玩家承受完整战斗力
    }
  }
  return { damage, gunSuppression: true };
}
