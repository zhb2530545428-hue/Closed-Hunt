// 多人同步层共享类型（服务端 API 与客户端 store 均使用）。

import type { GameRoom } from "@/game/types";

/** 服务端返回的房间信封：房间数据 + 乐观锁版本号 */
export interface RoomEnvelope {
  room: GameRoom;
  rev: number;
}

/** 阶段快照（房主回滚用） */
export interface RoomSnapshot {
  label: string;
  round: number;
  phase: string;
  room: GameRoom;
  createdAt: string;
}

/** 本浏览器在某房间的身份（存 localStorage） */
export interface LocalIdentity {
  code: string;
  playerId: string;
  token: string;
  isHost: boolean;
}

/** 服务端保存的房间密钥（不下发给普通玩家） */
export interface RoomTokens {
  host: string;
  players: Record<string, string>;
}

/** 创建/加入房间后服务端返回的内容 */
export interface JoinResult extends RoomEnvelope {
  playerId: string;
  token: string;
  isHost: boolean;
}

/** 保留的快照数量上限（v1.0 简化版回滚） */
export const MAX_SNAPSHOTS = 5;

/** 触发自动快照的阶段（进入该阶段后保存一份） */
export const SNAPSHOT_PHASES = ["FREE", "ACTION", "RESOLUTION", "GAME_OVER"] as const;
