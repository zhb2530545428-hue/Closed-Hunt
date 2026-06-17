// 同步适配层：本地（localStorage 单机/同浏览器多标签）与远程（Supabase via API）两种实现。
// 由 NEXT_PUBLIC_SUPABASE_URL 是否配置决定使用哪种。引擎与 store 逻辑对两者一致。

import type { GameRoom } from "@/game/types";
import type { JoinResult, RoomEnvelope, RoomSnapshot } from "@/shared/sync";
import { MAX_SNAPSHOTS, SNAPSHOT_PHASES } from "@/shared/sync";
import { createGame, joinGame } from "@/game/engine";
import { formatRoundLabel } from "@/game/config/rounds";

export interface SnapshotMeta {
  index: number;
  label: string;
  round: number;
  phase: string;
  createdAt: string;
}

export class ConflictError extends Error {}

export interface SyncAdapter {
  readonly mode: "local" | "remote";
  createRoom(hostName: string, devMode: boolean): Promise<JoinResult>;
  fetchRoom(code: string): Promise<RoomEnvelope | null>;
  pushRoom(code: string, room: GameRoom, baseRev: number, token: string): Promise<RoomEnvelope>;
  joinSeat(code: string, seatIndex: number, name: string, token?: string): Promise<JoinResult>;
  listSnapshots(code: string, token: string): Promise<SnapshotMeta[]>;
  rollback(code: string, index: number, token: string): Promise<RoomEnvelope>;
}

export function isRemoteMode(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

// ——————————————————————————— 本地适配器 ———————————————————————————

const ROOMS_KEY = "closed-hunt:rooms";
const REVS_KEY = "closed-hunt:revs";
const SNAPS_KEY = "closed-hunt:snaps";

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function localMaybeSnapshot(prev: GameRoom | undefined, next: GameRoom, snaps: RoomSnapshot[]): RoomSnapshot[] {
  if (prev && prev.currentPhase === next.currentPhase && prev.currentRound === next.currentRound) return snaps;
  if (!SNAPSHOT_PHASES.includes(next.currentPhase as (typeof SNAPSHOT_PHASES)[number])) return snaps;
  return [
    ...snaps,
    {
      label: `${formatRoundLabel(next.currentRound)} · ${next.currentPhase}`,
      round: next.currentRound,
      phase: next.currentPhase,
      room: next,
      createdAt: new Date().toISOString(),
    },
  ].slice(-MAX_SNAPSHOTS);
}

export const localAdapter: SyncAdapter = {
  mode: "local",

  async createRoom(hostName, devMode) {
    const rooms = lsGet<Record<string, GameRoom>>(ROOMS_KEY, {});
    const room = createGame({ hostName, existingCodes: Object.keys(rooms), devMode });
    rooms[room.roomCode] = room;
    lsSet(ROOMS_KEY, rooms);
    const revs = lsGet<Record<string, number>>(REVS_KEY, {});
    revs[room.roomCode] = 1;
    lsSet(REVS_KEY, revs);
    return { room, rev: 1, playerId: room.hostPlayerId, token: "local", isHost: true };
  },

  async fetchRoom(code) {
    const rooms = lsGet<Record<string, GameRoom>>(ROOMS_KEY, {});
    const room = rooms[code];
    if (!room) return null;
    const revs = lsGet<Record<string, number>>(REVS_KEY, {});
    return { room, rev: revs[code] ?? 1 };
  },

  async pushRoom(code, room, _baseRev, _token) {
    const rooms = lsGet<Record<string, GameRoom>>(ROOMS_KEY, {});
    const prev = rooms[code];
    rooms[code] = room;
    lsSet(ROOMS_KEY, rooms);
    const revs = lsGet<Record<string, number>>(REVS_KEY, {});
    const rev = (revs[code] ?? 1) + 1;
    revs[code] = rev;
    lsSet(REVS_KEY, revs);
    const allSnaps = lsGet<Record<string, RoomSnapshot[]>>(SNAPS_KEY, {});
    allSnaps[code] = localMaybeSnapshot(prev, room, allSnaps[code] ?? []);
    lsSet(SNAPS_KEY, allSnaps);
    return { room, rev };
  },

  async joinSeat(code, seatIndex, name) {
    const rooms = lsGet<Record<string, GameRoom>>(ROOMS_KEY, {});
    const room = rooms[code];
    if (!room) throw new Error("房间不存在。");
    const { room: next, player } = joinGame(room, name, seatIndex);
    rooms[code] = next;
    lsSet(ROOMS_KEY, rooms);
    const revs = lsGet<Record<string, number>>(REVS_KEY, {});
    revs[code] = (revs[code] ?? 1) + 1;
    lsSet(REVS_KEY, revs);
    return { room: next, rev: revs[code], playerId: player.id, token: "local", isHost: false };
  },

  async listSnapshots(code) {
    const allSnaps = lsGet<Record<string, RoomSnapshot[]>>(SNAPS_KEY, {});
    return (allSnaps[code] ?? []).map((s, index) => ({
      index,
      label: s.label,
      round: s.round,
      phase: s.phase,
      createdAt: s.createdAt,
    }));
  },

  async rollback(code, index) {
    const allSnaps = lsGet<Record<string, RoomSnapshot[]>>(SNAPS_KEY, {});
    const snap = (allSnaps[code] ?? [])[index];
    if (!snap) throw new Error("快照不存在。");
    const rooms = lsGet<Record<string, GameRoom>>(ROOMS_KEY, {});
    rooms[code] = snap.room;
    lsSet(ROOMS_KEY, rooms);
    const revs = lsGet<Record<string, number>>(REVS_KEY, {});
    revs[code] = (revs[code] ?? 1) + 1;
    lsSet(REVS_KEY, revs);
    return { room: snap.room, rev: revs[code] };
  },
};

/** 本地模式跨标签页订阅。 */
export function subscribeLocal(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key === ROOMS_KEY || e.key === REVS_KEY) cb();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// ——————————————————————————— 远程适配器 ———————————————————————————

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409) throw new ConflictError(data.error ?? "状态冲突。");
    throw new Error(data.error ?? `请求失败（${res.status}）。`);
  }
  return data as T;
}

export const remoteAdapter: SyncAdapter = {
  mode: "remote",

  createRoom(hostName, devMode) {
    return api<JoinResult>("/api/room", {
      method: "POST",
      body: JSON.stringify({ hostName, devMode }),
    });
  },

  async fetchRoom(code) {
    try {
      return await api<RoomEnvelope>(`/api/room/${code}`);
    } catch (e) {
      if (e instanceof Error && /不存在|404/.test(e.message)) return null;
      throw e;
    }
  },

  pushRoom(code, room, baseRev, token) {
    return api<RoomEnvelope>(`/api/room/${code}`, {
      method: "PUT",
      body: JSON.stringify({ room, baseRev, token }),
    });
  },

  joinSeat(code, seatIndex, name, token) {
    return api<JoinResult>(`/api/room/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ seatIndex, name, token }),
    });
  },

  async listSnapshots(code, token) {
    const data = await api<{ snapshots: SnapshotMeta[] }>(
      `/api/room/${code}/snapshots?token=${encodeURIComponent(token)}`
    );
    return data.snapshots;
  },

  rollback(code, index, token) {
    return api<RoomEnvelope>(`/api/room/${code}/rollback`, {
      method: "POST",
      body: JSON.stringify({ index, token }),
    });
  },
};

export function getAdapter(): SyncAdapter {
  return isRemoteMode() ? remoteAdapter : localAdapter;
}
