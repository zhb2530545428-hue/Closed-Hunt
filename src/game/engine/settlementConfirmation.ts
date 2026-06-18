import type { GameRoom, Player, SettlementResourceConfirmation } from "../types";
import { roleName } from "../utils/names";

export const CONFIRMABLE_SETTLEMENT_ITEMS = ["water", "food", "pill", "juice", "adrenaline"];

function roundKey(room: GameRoom): string {
  return String(room.currentRound);
}

function hasSettlementItem(p: Player): boolean {
  return p.inventory.some((id) => CONFIRMABLE_SETTLEMENT_ITEMS.includes(id));
}

function hasUsableCharitySkill(room: GameRoom, p: Player): boolean {
  if (p.roleId !== "philanthropist" || p.status !== "alive" || p.inventory.length === 0) return false;
  return room.players.some((target) => target.name && target.id !== p.id && target.status === "alive" && !target.giftedDone);
}

export function playerNeedsSettlementConfirmation(room: GameRoom, p: Player): boolean {
  if (!p.name || p.status !== "alive") return false;
  return hasSettlementItem(p) || hasUsableCharitySkill(room, p);
}

export function refreshSettlementConfirmations(room: GameRoom): GameRoom {
  const key = roundKey(room);
  const existing = new Map(
    (room.settlementConfirmations ?? [])
      .filter((c) => c.roundKey === key)
      .map((c) => [c.playerId, c])
  );
  const current: SettlementResourceConfirmation[] = room.players
    .filter((p) => playerNeedsSettlementConfirmation(room, p))
    .map((p) => ({
      playerId: p.id,
      roundKey: key,
      hasConfirmableResources: true,
      confirmed: existing.get(p.id)?.confirmed ?? false,
    }));
  return {
    ...room,
    settlementConfirmations: [
      ...(room.settlementConfirmations ?? []).filter((c) => c.roundKey !== key),
      ...current,
    ],
  };
}

export function markSettlementConfirmed(room: GameRoom, playerId: string): GameRoom {
  const key = roundKey(room);
  const refreshed = refreshSettlementConfirmations(room);
  const needs = refreshed.settlementConfirmations.some((c) => c.roundKey === key && c.playerId === playerId);
  if (!needs) return refreshed;
  return {
    ...refreshed,
    settlementConfirmations: refreshed.settlementConfirmations.map((c) =>
      c.roundKey === key && c.playerId === playerId ? { ...c, confirmed: true } : c
    ),
  };
}

export function missingSettlementConfirmers(room: GameRoom): Player[] {
  const refreshed = refreshSettlementConfirmations(room);
  const key = roundKey(refreshed);
  const missingIds = new Set(
    refreshed.settlementConfirmations
      .filter((c) => c.roundKey === key && c.hasConfirmableResources && !c.confirmed)
      .map((c) => c.playerId)
  );
  return refreshed.players.filter((p) => missingIds.has(p.id));
}

export function assertSettlementConfirmationsReady(room: GameRoom): void {
  if (room.currentPhase !== "RESOLUTION") return;
  const missing = missingSettlementConfirmers(room);
  if (missing.length === 0) return;
  throw new Error(`仍有玩家未确认结算资源选择：${missing.map(roleName).join("、")}。请等待他们确认后再应用结算。`);
}
