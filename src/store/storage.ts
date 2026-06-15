// 存储适配层。v0.1 使用 localStorage，并通过 storage 事件实现同机多标签页实时同步。
// 后续 v0.2 可实现同样的 StorageAdapter 接口接入 Supabase / Firebase。

import type { GameRoom } from "@/game/types";

const ROOMS_KEY = "closed-hunt:rooms";
const IDENTITY_KEY = "closed-hunt:identities";

export interface PersistedState {
  /** roomCode -> 房间 */
  rooms: Record<string, GameRoom>;
  /** roomCode -> 本浏览器在该房间的玩家 id（刷新后回到座位） */
  identities: Record<string, string>;
}

export interface StorageAdapter {
  load(): PersistedState;
  save(state: PersistedState): void;
  /** 订阅外部变更（其他标签页）。返回取消订阅函数。 */
  subscribe(cb: () => void): () => void;
}

const empty: PersistedState = { rooms: {}, identities: {} };

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const localStorageAdapter: StorageAdapter = {
  load() {
    if (typeof window === "undefined") return { ...empty };
    return {
      rooms: safeParse(window.localStorage.getItem(ROOMS_KEY), {}),
      identities: safeParse(window.localStorage.getItem(IDENTITY_KEY), {}),
    };
  },
  save(state) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ROOMS_KEY, JSON.stringify(state.rooms));
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(state.identities));
  },
  subscribe(cb) {
    if (typeof window === "undefined") return () => {};
    const handler = (e: StorageEvent) => {
      if (e.key === ROOMS_KEY || e.key === IDENTITY_KEY) cb();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};
