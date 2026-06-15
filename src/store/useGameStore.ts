// 全局游戏状态（Zustand）。所有状态变更集中在此，通过 apply() 调用纯引擎函数，
// 每次变更后写入存储适配层；同机其他标签页通过 storage 事件自动刷新。

import { create } from "zustand";
import { localStorageAdapter } from "./storage";
import type { GameRoom } from "@/game/types";
import { createGame } from "@/game/engine";

interface GameState {
  rooms: Record<string, GameRoom>;
  identities: Record<string, string>;
  hydrated: boolean;

  /** 从存储载入并订阅跨标签页变更（客户端调用一次） */
  hydrate: () => void;

  getRoom: (code: string) => GameRoom | undefined;
  getIdentity: (code: string) => string | undefined;
  setIdentity: (code: string, playerId: string) => void;

  /** 创建房间，返回房间码，并把当前浏览器身份设为房主 */
  createRoom: (hostName: string, devMode: boolean) => string;

  /**
   * 对某房间应用一次引擎变更。fn 接收当前房间，返回新房间（引擎函数可能抛错，调用方需 catch）。
   * 这是所有房间状态变更的唯一入口。
   */
  apply: (code: string, fn: (room: GameRoom) => GameRoom) => void;
}

function persist(state: { rooms: Record<string, GameRoom>; identities: Record<string, string> }) {
  localStorageAdapter.save({ rooms: state.rooms, identities: state.identities });
}

let subscribed = false;

export const useGameStore = create<GameState>((set, get) => ({
  rooms: {},
  identities: {},
  hydrated: false,

  hydrate: () => {
    const loaded = localStorageAdapter.load();
    set({ rooms: loaded.rooms, identities: loaded.identities, hydrated: true });
    if (!subscribed) {
      subscribed = true;
      localStorageAdapter.subscribe(() => {
        const fresh = localStorageAdapter.load();
        set({ rooms: fresh.rooms, identities: fresh.identities });
      });
    }
  },

  getRoom: (code) => get().rooms[code],
  getIdentity: (code) => get().identities[code],

  setIdentity: (code, playerId) => {
    set((s) => {
      const identities = { ...s.identities, [code]: playerId };
      persist({ rooms: s.rooms, identities });
      return { identities };
    });
  },

  createRoom: (hostName, devMode) => {
    const existing = Object.keys(get().rooms);
    const room = createGame({ hostName, existingCodes: existing, devMode });
    set((s) => {
      const rooms = { ...s.rooms, [room.roomCode]: room };
      const identities = { ...s.identities, [room.roomCode]: room.hostPlayerId };
      persist({ rooms, identities });
      return { rooms, identities };
    });
    return room.roomCode;
  },

  apply: (code, fn) => {
    const current = get().rooms[code];
    if (!current) throw new Error("房间不存在。");
    const updated = fn(current); // 引擎为纯函数，抛错在此向上传播，不会写入状态
    set((s) => {
      const rooms = { ...s.rooms, [code]: updated };
      persist({ rooms, identities: s.identities });
      return { rooms };
    });
  },
}));
