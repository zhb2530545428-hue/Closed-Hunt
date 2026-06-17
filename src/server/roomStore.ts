// 服务端房间仓库：封装 Supabase 读写、乐观锁、令牌校验、自动快照与回滚。
// 整局 GameRoom 作为一行 JSONB 存储；引擎仍是唯一规则来源（此处仅做存储与并发控制）。

import { getSupabaseAdmin, ROOMS_TABLE } from "./supabaseAdmin";
import type { GameRoom } from "@/game/types";
import type { JoinResult, RoomEnvelope, RoomSnapshot, RoomTokens } from "@/shared/sync";
import { MAX_SNAPSHOTS, SNAPSHOT_PHASES } from "@/shared/sync";
import { createGame, joinGame } from "@/game/engine";
import { formatRoundLabel } from "@/game/config/rounds";
import { randomUUID } from "crypto";

/** 业务错误，路由层据 code 映射 HTTP 状态。 */
export class RoomError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface RoomRow {
  room_code: string;
  rev: number;
  room: GameRoom;
  tokens: RoomTokens;
  snapshots: RoomSnapshot[];
}

function newToken(): string {
  return randomUUID().replace(/-/g, "");
}

async function fetchRow(code: string): Promise<RoomRow | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from(ROOMS_TABLE)
    .select("room_code, rev, room, tokens, snapshots")
    .eq("room_code", code)
    .maybeSingle();
  if (error) throw new RoomError(`数据库读取失败：${error.message}`, 500);
  return (data as RoomRow | null) ?? null;
}

/** 校验令牌是否属于该房间（房主或任一玩家）。返回是否为房主。 */
function authorize(tokens: RoomTokens, token: string | undefined): { ok: boolean; isHost: boolean } {
  if (!token) return { ok: false, isHost: false };
  if (tokens.host === token) return { ok: true, isHost: true };
  const ok = Object.values(tokens.players ?? {}).includes(token);
  return { ok, isHost: false };
}

function requireHost(tokens: RoomTokens, token: string | undefined): void {
  if (tokens.host !== token) throw new RoomError("仅房主可执行该操作。", 403);
}

/** 创建房间：生成房主令牌并入库。 */
export async function createRoomRemote(hostName: string, devMode: boolean): Promise<JoinResult> {
  const db = getSupabaseAdmin();
  // 避免房间码冲突：取已有码
  const { data: codes } = await db.from(ROOMS_TABLE).select("room_code");
  const existing = (codes ?? []).map((r: { room_code: string }) => r.room_code);
  const room = createGame({ hostName, existingCodes: existing, devMode });

  const hostToken = newToken();
  const tokens: RoomTokens = { host: hostToken, players: { [room.hostPlayerId]: hostToken } };

  const { error } = await db.from(ROOMS_TABLE).insert({
    room_code: room.roomCode,
    rev: 1,
    room,
    tokens,
    snapshots: [],
  });
  if (error) throw new RoomError(`房间创建失败：${error.message}`, 500);

  return { room, rev: 1, playerId: room.hostPlayerId, token: hostToken, isHost: true };
}

/** 读取房间（公共数据 + rev），不含令牌。 */
export async function getRoomRemote(code: string): Promise<RoomEnvelope | null> {
  const row = await fetchRow(code);
  if (!row) return null;
  return { room: row.room, rev: row.rev };
}

function maybeSnapshot(prev: GameRoom, next: GameRoom, snapshots: RoomSnapshot[]): RoomSnapshot[] {
  const phaseChanged = prev.currentPhase !== next.currentPhase || prev.currentRound !== next.currentRound;
  if (!phaseChanged) return snapshots;
  if (!SNAPSHOT_PHASES.includes(next.currentPhase as (typeof SNAPSHOT_PHASES)[number])) return snapshots;
  const snap: RoomSnapshot = {
    label: `${formatRoundLabel(next.currentRound)} · ${next.currentPhase}`,
    round: next.currentRound,
    phase: next.currentPhase,
    room: next,
    createdAt: new Date().toISOString(),
  };
  return [...snapshots, snap].slice(-MAX_SNAPSHOTS);
}

/** 乐观锁写入房间：baseRev 必须等于当前 rev，否则 409 冲突。 */
export async function pushRoomRemote(
  code: string,
  room: GameRoom,
  baseRev: number,
  token: string | undefined
): Promise<RoomEnvelope> {
  const db = getSupabaseAdmin();
  const row = await fetchRow(code);
  if (!row) throw new RoomError("房间不存在。", 404);
  const { ok } = authorize(row.tokens, token);
  if (!ok) throw new RoomError("无效令牌，无权修改该房间。", 403);
  if (row.rev !== baseRev) {
    throw new RoomError("房间状态已被他人更新，请刷新后重试。", 409);
  }

  const nextRev = row.rev + 1;
  const snapshots = maybeSnapshot(row.room, room, row.snapshots ?? []);
  const finished = room.currentPhase === "GAME_OVER";

  const { error } = await db
    .from(ROOMS_TABLE)
    .update({
      rev: nextRev,
      room,
      snapshots,
      ...(finished ? { finished_at: new Date().toISOString() } : {}),
    })
    .eq("room_code", code)
    .eq("rev", baseRev); // 双重保险：并发下仅一方成功
  if (error) throw new RoomError(`写入失败：${error.message}`, 500);

  return { room, rev: nextRev };
}

/** 加入座位：已持有效令牌则视为重连；否则执行 joinGame 并发放令牌。 */
export async function joinSeatRemote(
  code: string,
  seatIndex: number,
  name: string,
  token: string | undefined
): Promise<JoinResult> {
  const db = getSupabaseAdmin();
  const row = await fetchRow(code);
  if (!row) throw new RoomError("房间不存在。", 404);

  // 重连：令牌已属于某玩家，直接返回其身份
  if (token) {
    const auth = authorize(row.tokens, token);
    if (auth.ok) {
      const pid = Object.entries(row.tokens.players).find(([, t]) => t === token)?.[0];
      if (pid) {
        return { room: row.room, rev: row.rev, playerId: pid, token, isHost: auth.isHost };
      }
    }
  }

  // 新加入：运行引擎落座
  let result: { room: GameRoom; player: { id: string } };
  try {
    result = joinGame(row.room, name, seatIndex);
  } catch (e) {
    throw new RoomError(e instanceof Error ? e.message : "加入失败。", 400);
  }
  const playerToken = newToken();
  const nextRev = row.rev + 1;
  const tokens: RoomTokens = {
    ...row.tokens,
    players: { ...row.tokens.players, [result.player.id]: playerToken },
  };

  const { error } = await db
    .from(ROOMS_TABLE)
    .update({ rev: nextRev, room: result.room, tokens })
    .eq("room_code", code)
    .eq("rev", row.rev);
  if (error) throw new RoomError(`加入失败：${error.message}`, 500);

  return { room: result.room, rev: nextRev, playerId: result.player.id, token: playerToken, isHost: false };
}

/** 房主：列出快照。 */
export async function listSnapshotsRemote(code: string, token: string | undefined): Promise<RoomSnapshot[]> {
  const row = await fetchRow(code);
  if (!row) throw new RoomError("房间不存在。", 404);
  requireHost(row.tokens, token);
  return row.snapshots ?? [];
}

/** 房主：回滚到指定快照（index 为 snapshots 数组下标）。 */
export async function rollbackRemote(code: string, index: number, token: string | undefined): Promise<RoomEnvelope> {
  const db = getSupabaseAdmin();
  const row = await fetchRow(code);
  if (!row) throw new RoomError("房间不存在。", 404);
  requireHost(row.tokens, token);
  const snaps = row.snapshots ?? [];
  const snap = snaps[index];
  if (!snap) throw new RoomError("快照不存在。", 404);

  const nextRev = row.rev + 1;
  const { error } = await db
    .from(ROOMS_TABLE)
    .update({ rev: nextRev, room: snap.room })
    .eq("room_code", code)
    .eq("rev", row.rev);
  if (error) throw new RoomError(`回滚失败：${error.message}`, 500);
  return { room: snap.room, rev: nextRev };
}
