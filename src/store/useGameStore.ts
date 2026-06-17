// 全局游戏状态（Zustand）。所有房间状态变更集中在 apply()，通过纯引擎函数计算，
// 再经同步适配层落地：本地模式写 localStorage（多标签页 storage 事件同步），
// 远程模式写 Supabase（轮询同步、乐观锁、断线重连）。

import { create } from "zustand";
import type { GameRoom } from "@/game/types";
import { joinGame } from "@/game/engine";
import { migrateRoomItems } from "@/game/inventory";
import type { LocalIdentity } from "@/shared/sync";
import {
  getAdapter,
  isRemoteMode,
  subscribeLocal,
  ConflictError,
  type SnapshotMeta,
} from "./sync";
import { loadAllIdentities, loadIdentity, saveIdentity, clearIdentity } from "./identity";

interface GameState {
  rooms: Record<string, GameRoom>;
  revs: Record<string, number>;
  /** code -> 当前显示的玩家 id（UI 选择/落座结果） */
  identities: Record<string, string>;
  /** code -> 完整身份（含写入令牌） */
  idTokens: Record<string, LocalIdentity>;
  hydrated: boolean;
  lastError: string | null;

  hydrate: () => void;
  /** 开始同步某房间（远程轮询 / 本地确保载入），返回取消函数。 */
  watchRoom: (code: string) => () => void;
  refresh: (code: string) => Promise<void>;

  getRoom: (code: string) => GameRoom | undefined;
  getIdentity: (code: string) => LocalIdentity | undefined;
  setIdentity: (code: string, playerId: string) => void;
  clearError: () => void;

  createRoom: (hostName: string, devMode: boolean) => Promise<string>;
  joinSeat: (code: string, seatIndex: number, name: string) => Promise<string>;

  /** 房间状态变更唯一入口：同步执行引擎函数（可能抛错），乐观更新，后台落地。 */
  apply: (code: string, fn: (room: GameRoom) => GameRoom) => void;

  listSnapshots: (code: string) => Promise<SnapshotMeta[]>;
  rollback: (code: string, index: number) => Promise<void>;
}

const adapter = getAdapter();

// 每个房间串行化推送，避免乐观锁竞争
const pushQueue = new Map<string, Promise<void>>();
const pending = new Set<string>(); // 正在推送中的房间，轮询时跳过覆盖
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();
let localSubscribed = false;

export const useGameStore = create<GameState>((set, get) => {
  // 串行化的「推送最新内存房间」：避免 apply 捕获的旧快照覆盖随后发生的加入/编辑。
  // 每次落地推送的都是 get().rooms[code] 的当前累积状态，而非调用时的快照。
  const pushLatest = (code: string) => {
    const token = get().idTokens[code]?.token ?? "local";
    const run = async () => {
      pending.add(code);
      try {
        const room = get().rooms[code];
        if (!room) return;
        const baseRev = get().revs[code] ?? 1;
        const env = await adapter.pushRoom(code, room, baseRev, token);
        // 关键：await 期间内存可能已被更新的加入/编辑推进。仅当内存仍是我们推送的那份
        // （引用未变）时才回写房间，否则只更新版本号，避免旧快照覆盖更新的乐观状态。
        set((s) => ({
          rooms: s.rooms[code] === room ? { ...s.rooms, [code]: env.room } : s.rooms,
          revs: { ...s.revs, [code]: env.rev },
        }));
      } catch (e) {
        if (e instanceof ConflictError) {
          set({ lastError: "操作冲突：状态已更新，已为你刷新，请重试。" });
        } else {
          set({ lastError: e instanceof Error ? e.message : String(e) });
        }
        pending.delete(code);
        await get().refresh(code); // 拉回服务端最新，丢弃本地乐观变更
        return;
      }
      pending.delete(code);
    };
    const prev = pushQueue.get(code) ?? Promise.resolve();
    const next = prev.then(run, run);
    pushQueue.set(code, next);
  };

  return {
  rooms: {},
  revs: {},
  identities: {},
  idTokens: {},
  hydrated: false,
  lastError: null,

  hydrate: () => {
    const idMap = loadAllIdentities();
    const identities: Record<string, string> = {};
    for (const [code, id] of Object.entries(idMap)) identities[code] = id.playerId;

    if (isRemoteMode()) {
      set({ idTokens: idMap, identities, hydrated: true });
      return;
    }

    // 本地模式：载入全部房间并订阅跨标签页变更
    const reload = () => {
      const rooms: Record<string, GameRoom> = {};
      const revs: Record<string, number> = {};
      for (const code of Object.keys(loadAllIdentities())) {
        /* 身份房间稍后由 fetch 填充 */
        void code;
      }
      // 直接从 localStorage 读取全部房间
      try {
        const raw = window.localStorage.getItem("closed-hunt:rooms");
        const all = raw ? (JSON.parse(raw) as Record<string, GameRoom>) : {};
        const rawRev = window.localStorage.getItem("closed-hunt:revs");
        const allRev = rawRev ? (JSON.parse(rawRev) as Record<string, number>) : {};
        for (const [code, r] of Object.entries(all)) rooms[code] = migrateRoomItems(r);
        Object.assign(revs, allRev);
      } catch {
        /* ignore */
      }
      set({ rooms, revs });
    };
    reload();
    set({ idTokens: idMap, identities, hydrated: true });
    if (!localSubscribed) {
      localSubscribed = true;
      subscribeLocal(reload);
    }
  },

  watchRoom: (code) => {
    void get().refresh(code);
    if (!isRemoteMode()) return () => {};
    if (pollTimers.has(code)) return () => {};
    const timer = setInterval(() => {
      if (!pending.has(code)) void get().refresh(code);
    }, 1500);
    pollTimers.set(code, timer);
    return () => {
      clearInterval(timer);
      pollTimers.delete(code);
    };
  },

  refresh: async (code) => {
    try {
      const env = await adapter.fetchRoom(code);
      if (!env) return;
      if (pending.has(code)) return; // 有未落地的本地变更，避免被旧状态覆盖
      const curRev = get().revs[code] ?? 0;
      if (env.rev >= curRev) {
        set((s) => ({ rooms: { ...s.rooms, [code]: migrateRoomItems(env.room) }, revs: { ...s.revs, [code]: env.rev } }));
      }
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  getRoom: (code) => get().rooms[code],
  getIdentity: (code) => get().idTokens[code],

  setIdentity: (code, playerId) => {
    const isHost = get().rooms[code]?.hostPlayerId === playerId;
    const existing = get().idTokens[code];
    const id: LocalIdentity = {
      code,
      playerId,
      token: existing?.token ?? "local",
      isHost,
    };
    saveIdentity(id);
    set((s) => ({
      identities: { ...s.identities, [code]: playerId },
      idTokens: { ...s.idTokens, [code]: id },
    }));
  },

  clearError: () => set({ lastError: null }),

  createRoom: async (hostName, devMode) => {
    const res = await adapter.createRoom(hostName, devMode);
    const id: LocalIdentity = { code: res.room.roomCode, playerId: res.playerId, token: res.token, isHost: true };
    saveIdentity(id);
    set((s) => ({
      rooms: { ...s.rooms, [res.room.roomCode]: res.room },
      revs: { ...s.revs, [res.room.roomCode]: res.rev },
      identities: { ...s.identities, [res.room.roomCode]: res.playerId },
      idTokens: { ...s.idTokens, [res.room.roomCode]: id },
    }));
    return res.room.roomCode;
  },

  joinSeat: async (code, seatIndex, name) => {
    // 远程：座位加入由服务端鉴权并下发写入令牌，保持服务端权威。
    if (adapter.mode === "remote") {
      const existing = get().idTokens[code];
      const res = await adapter.joinSeat(code, seatIndex, name, existing?.token);
      const id: LocalIdentity = { code, playerId: res.playerId, token: res.token, isHost: res.isHost };
      saveIdentity(id);
      set((s) => ({
        rooms: { ...s.rooms, [code]: res.room },
        revs: { ...s.revs, [code]: res.rev },
        identities: { ...s.identities, [code]: res.playerId },
        idTokens: { ...s.idTokens, [code]: id },
      }));
      return res.playerId;
    }

    // 本地热座：直接在【内存最新房间】上加入，并走与 apply 同一条串行推送队列，
    // 避免旧路径「读 localStorage→改→写」与 apply 的异步推送相互覆盖导致加入丢失。
    const current = get().rooms[code];
    if (!current) throw new Error("房间不存在。");
    const { room: next, player } = joinGame(current, name, seatIndex);
    const id: LocalIdentity = { code, playerId: player.id, token: "local", isHost: player.id === current.hostPlayerId };
    saveIdentity(id);
    set((s) => ({
      rooms: { ...s.rooms, [code]: next },
      identities: { ...s.identities, [code]: player.id },
      idTokens: { ...s.idTokens, [code]: id },
      lastError: null,
    }));
    pushLatest(code);
    return player.id;
  },

  apply: (code, fn) => {
    const current = get().rooms[code];
    if (!current) throw new Error("房间不存在。");
    const updated = fn(current); // 纯引擎函数，校验失败在此同步抛出，由调用方 try/catch
    // 乐观更新内存，落地推送由 pushLatest 串行执行（推送的是最新累积状态）
    set((s) => ({ rooms: { ...s.rooms, [code]: updated }, lastError: null }));
    pushLatest(code);
  },

  listSnapshots: async (code) => {
    const token = get().idTokens[code]?.token ?? "local";
    return adapter.listSnapshots(code, token);
  },

  rollback: async (code, index) => {
    const token = get().idTokens[code]?.token ?? "local";
    const env = await adapter.rollback(code, index, token);
    set((s) => ({ rooms: { ...s.rooms, [code]: migrateRoomItems(env.room) }, revs: { ...s.revs, [code]: env.rev } }));
  },
  };
});

export { clearIdentity };
