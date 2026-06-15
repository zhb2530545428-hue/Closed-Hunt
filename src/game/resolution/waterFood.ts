// 水粮扣血（纯函数）。来源：规则手册 12.2；开发指令 3.8。

/** 上交 1 水+1 粮不扣血；缺一 -1；全缺 -2。返回扣血量（正数）。 */
export function waterFoodDamage(submittedWater: boolean, submittedFood: boolean): number {
  if (submittedWater && submittedFood) return 0;
  if (!submittedWater && !submittedFood) return 2;
  return 1;
}
