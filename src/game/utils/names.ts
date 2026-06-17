// 玩家名称展示（v1.0.2 §6）。
// 除首页 / 加入页 / 玩家个人身份页外，游戏内大多数位置优先显示「角色名称」，减少玩家 ID 干扰。
// 角色在开局统一解析后即公开（见 startGame 公布名单），故对局内显示角色名不泄露隐藏信息。

import type { Player } from "../types";
import { getRole } from "../config/roles";

export type ViewerMode = "public" | "player" | "host";

/**
 * 统一的玩家名称格式化：
 * - public / player：优先「角色名」，未定角色则回退昵称；
 * - host（房主裁判）：「角色名·昵称·#座位」，便于排查。
 * 避免各处 UI 自行拼接造成不一致。
 */
export function formatPlayerName(p: Player, mode: ViewerMode = "public"): string {
  const role = getRole(p.roleId)?.name;
  const nick = p.name || `玩家${p.seatIndex + 1}`;
  if (mode === "host") {
    return role ? `${role}·${nick}·#${p.seatIndex + 1}` : `${nick}·#${p.seatIndex + 1}`;
  }
  return role ?? nick;
}

/** 简洁的「角色名（昵称）」标签，供对局内多数列表 / 下拉框使用。 */
export function roleWithNick(p: Player): string {
  const role = getRole(p.roleId)?.name;
  const nick = p.name || `玩家${p.seatIndex + 1}`;
  return role ? `${role}（${nick}）` : nick;
}

/** 仅角色名（结算日志用），未定角色回退昵称。 */
export function roleName(p: Player): string {
  return getRole(p.roleId)?.name ?? (p.name || `玩家${p.seatIndex + 1}`);
}
