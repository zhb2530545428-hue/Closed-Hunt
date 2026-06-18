"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { isRemoteMode } from "@/store/sync";
import { useEnsureHydrated, useWatchRoom } from "@/components/store-hooks";
import { Button, Card, Badge, cls } from "@/components/ui";
import type { GameRoom, Player } from "@/game/types";
import {
  updatePlayerSetup,
  randomRole,
  toggleReady,
  kickSeat,
  isGeneValid,
  canStartGame,
  startGame,
  fillTestPlayers,
  addRandomTestPlayer,
} from "@/game/engine";
import { ROLES, getRole } from "@/game/config/roles";
import { SPAWN_ROOMS } from "@/game/config/spawnRooms";
import { getRoomLabel } from "@/game/config/rooms";
import { formatRoundLabel } from "@/game/config/rounds";

export default function LobbyPage() {
  const params = useParams<{ roomCode: string }>();
  const code = (params.roomCode as string)?.toUpperCase();
  const router = useRouter();
  const hydrated = useEnsureHydrated();
  useWatchRoom(code);

  const room = useGameStore((s) => s.rooms[code]);
  const myId = useGameStore((s) => s.identities[code]);
  const apply = useGameStore((s) => s.apply);
  const joinSeat = useGameStore((s) => s.joinSeat);
  const setIdentity = useGameStore((s) => s.setIdentity);
  const lastError = useGameStore((s) => s.lastError);

  const [error, setError] = useState("");
  const remote = isRemoteMode();

  if (!hydrated) return <Loading />;
  if (!room) return <NotFound code={code} remote={remote} />;

  if (room.currentPhase !== "LOBBY") {
    return (
      <main className="max-w-md mx-auto px-4 py-10 text-center space-y-4">
        <p className="text-slate-300">游戏已开始（{formatRoundLabel(room.currentRound)}）。</p>
        <div className="flex gap-2 justify-center">
          <Link href={`/room/${code}/play`}><Button variant="gold">进入我的面板</Button></Link>
          <Link href={`/room/${code}/board`}><Button variant="primary">公共战况</Button></Link>
        </div>
      </main>
    );
  }

  const run = (fn: (room: GameRoom) => GameRoom) => {
    setError("");
    try {
      apply(code, fn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const isHost = myId === room.hostPlayerId;
  const startCheck = canStartGame(room);

  const handleStart = () => {
    setError("");
    try {
      apply(code, (r) => startGame(r));
      router.push(`/room/${code}/board`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyInvite = () => {
    const url = `${window.location.origin}/room/${code}`;
    navigator.clipboard?.writeText(url).catch(() => {});
  };

  const handleJoin = async (seatIndex: number, name: string) => {
    setError("");
    try {
      await joinSeat(code, seatIndex, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加入失败。");
    }
  };

  return (
    <main className="max-w-4xl mx-auto px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <Link href="/" className="text-blue-400 underline text-sm">首页</Link>
          <h1 className="text-2xl font-bold">
            房间 <span className="text-gold tracking-widest">{code}</span>
            {room.devMode && <Badge tone="toxic">开发调试模式</Badge>}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={copyInvite}>复制邀请链接</Button>
          <Link href={`/room/${code}/board`}><Button variant="ghost">公共战况</Button></Link>
        </div>
      </header>

      {(error || lastError) && <ErrorBar msg={error || lastError || ""} />}

      {remote ? (
        <Card title="我的身份" className="mb-4">
          <p className="text-sm text-slate-300">
            {myId
              ? <>你控制：<span className="text-gold">{room.players.find((p) => p.id === myId)?.name ?? "（座位）"}</span>{myId === room.hostPlayerId ? "（房主）" : ""}。刷新或换设备打开本链接可自动重连。</>
              : "你尚未加入。请在下方空座位填写昵称加入。"}
          </p>
        </Card>
      ) : (
        <Card title="我控制的玩家" className="mb-4">
          <p className="text-xs text-slate-400 mb-2">
            本地热座：可在此屏直接填写多个座位用于测试；选择身份后「我的面板」将以该玩家视角显示。
          </p>
          <div className="flex flex-wrap gap-2">
            {room.players.filter((p) => p.name).map((p) => (
              <Button
                key={p.id}
                variant={p.id === myId ? "gold" : "ghost"}
                onClick={() => setIdentity(code, p.id)}
              >
                {p.seatIndex + 1}. {p.name}
                {p.id === room.hostPlayerId ? "（房主）" : ""}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {room.players.map((p) => (
          <SeatCard
            key={p.id}
            player={p}
            isHostSeat={p.id === room.hostPlayerId}
            isMe={p.id === myId}
            canKick={isHost && p.id !== room.hostPlayerId && !!p.name}
            onJoin={(name) => handleJoin(p.seatIndex, name)}
            onUpdate={(patch) => run((r) => updatePlayerSetup(r, p.id, patch))}
            onRandomRole={() => run((r) => randomRole(r, p.id))}
            onToggleReady={() => run((r) => toggleReady(r, p.id))}
            onKick={() => run((r) => kickSeat(r, p.seatIndex))}
          />
        ))}
      </div>

      <Card title="房主控制">
        {!isHost && (
          <p className="text-sm text-slate-400 mb-2">
            你不是房主。仅房主（{room.players.find((p) => p.id === room.hostPlayerId)?.name}）可开始游戏。
          </p>
        )}
        {/* §8：本地热座 / 房主调试专用——随机生成测试玩家，不对正式线上普通玩家开放。 */}
        {!remote && isHost && (
          <div className="mb-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => run((r) => addRandomTestPlayer(r))} disabled={room.players.every((p) => !!p.name)}>
                随机生成 1 名玩家（本地测试）
              </Button>
              <Button variant="ghost" onClick={() => run((r) => fillTestPlayers(r))}>
                一键生成 9 名玩家（本地测试）
              </Button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              自动填充唯一昵称 / 唯一角色 / 合法基因点（速度≥1）/ 出生房间并准备。座位满则「随机生成 1 名」禁用。
            </p>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="primary" disabled={!isHost || !startCheck.ok} onClick={handleStart}>
            开始游戏
          </Button>
          {!startCheck.ok && <span className="text-sm text-amber-300">{startCheck.reason}</span>}
          {startCheck.ok && <span className="text-sm text-toxic">满足开始条件。</span>}
        </div>
      </Card>
    </main>
  );
}

function SeatCard({
  player,
  isHostSeat,
  isMe,
  canKick,
  onJoin,
  onUpdate,
  onRandomRole,
  onToggleReady,
  onKick,
}: {
  player: Player;
  isHostSeat: boolean;
  isMe: boolean;
  canKick: boolean;
  onJoin: (name: string) => void;
  onUpdate: (patch: { name?: string; roleId?: string | null; genes?: { force: number; speed: number; load: number }; spawnRoom?: string }) => void;
  onRandomRole: () => void;
  onToggleReady: () => void;
  onKick: () => void;
}) {
  const [joinName, setJoinName] = useState("");
  const occupied = !!player.name;
  const geneSum = player.force + player.speed + player.load;
  const geneOk = isGeneValid({ force: player.force, speed: player.speed, load: player.load });

  // §1：准备阶段角色选择互相不可见——他人座位只显示「已提交/未提交」，不显示具体角色与设置。
  if (occupied && !isMe) {
    return (
      <Card className={cls(player.isReady && "border-toxic/50")}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold">
            {player.seatIndex + 1}. {player.name}
            {isHostSeat && <span className="text-gold text-xs ml-1">房主</span>}
          </span>
          {player.isReady ? <Badge tone="toxic">已准备</Badge> : <Badge>未准备</Badge>}
        </div>
        <div className="text-xs text-slate-400 space-y-1">
          <div>角色：{player.preferredRoleId ? "已选择（保密）" : "未选择"}</div>
          <div>基因点：{geneOk ? "已分配" : "未完成"}</div>
          <div>出生房间：{player.location ? "已选择" : "未选择"}</div>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">他人的角色在开局统一解析后才会公开。</p>
        {canKick && <Button variant="danger" className="mt-2" onClick={onKick}>清空</Button>}
      </Card>
    );
  }

  if (!occupied) {
    return (
      <Card className={cls("border-dashed", isMe && "ring-1 ring-gold")}>
        <div className="text-slate-400 text-sm mb-2">座位 {player.seatIndex + 1} · 空</div>
        <input
          className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1.5 mb-2 text-sm"
          placeholder="输入昵称加入"
          value={joinName}
          maxLength={12}
          onChange={(e) => setJoinName(e.target.value)}
        />
        <Button
          variant="gold"
          className="w-full"
          disabled={!joinName.trim()}
          onClick={() => joinName.trim() && onJoin(joinName.trim())}
        >
          {joinName.trim() ? "加入此座位" : "先输入昵称"}
        </Button>
      </Card>
    );
  }

  const setGene = (key: "force" | "speed" | "load", value: number) => {
    const genes = { force: player.force, speed: player.speed, load: player.load };
    // v1.0.3 §5.1：速度下限为 1（永不为 0）。
    const min = key === "speed" ? 1 : 0;
    genes[key] = Math.max(min, Math.min(10, value || 0));
    onUpdate({ genes });
  };

  return (
    <Card className={cls(isMe && "ring-1 ring-gold", player.isReady && "border-toxic/50")}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold">
          {player.seatIndex + 1}. {player.name}
          {isHostSeat && <span className="text-gold text-xs ml-1">房主</span>}
        </span>
        {player.isReady ? <Badge tone="toxic">已准备</Badge> : <Badge>未准备</Badge>}
      </div>

      <label className="block text-xs text-slate-400 mb-1">昵称</label>
      <input
        className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1 mb-2 text-sm"
        value={player.name}
        maxLength={12}
        onChange={(e) => onUpdate({ name: e.target.value })}
      />

      <label className="block text-xs text-slate-400 mb-1">想选的角色（保密，撞车时开局统一抽取）</label>
      <div className="flex gap-1 mb-1">
        <select
          className="flex-1 bg-ink-700 border border-ink-600 rounded px-2 py-1 text-sm"
          value={player.preferredRoleId ?? ""}
          onChange={(e) => onUpdate({ roleId: e.target.value || null })}
        >
          <option value="">未选择</option>
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <Button onClick={onRandomRole} className="px-2">随机</Button>
      </div>
      {player.preferredRoleId && (
        <p className="text-[11px] text-slate-400 mb-2 leading-snug">{getRole(player.preferredRoleId)?.skill}</p>
      )}

      <label className="block text-xs text-slate-400 mb-1">
        基因点（武力+速度+负重=10，当前 <span className={geneOk ? "text-toxic" : "text-red-400"}>{geneSum}</span>）
      </label>
      <div className="grid grid-cols-3 gap-1 mb-2">
        {(["force", "speed", "load"] as const).map((k) => (
          <div key={k}>
            <span className="text-[11px] text-slate-500">
              {k === "force" ? "武力" : k === "speed" ? "速度" : "负重"}
            </span>
            <input
              type="number"
              min={k === "speed" ? 1 : 0}
              max={10}
              className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1 text-sm"
              value={player[k]}
              onChange={(e) => setGene(k, parseInt(e.target.value, 10))}
            />
          </div>
        ))}
      </div>

      <label className="block text-xs text-slate-400 mb-1">出生房间</label>
      <select
        className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1 text-sm mb-3"
        value={player.location ?? ""}
        onChange={(e) => onUpdate({ spawnRoom: e.target.value })}
      >
        <option value="">未选择</option>
        {SPAWN_ROOMS.map((id) => (
          <option key={id} value={id}>{getRoomLabel(id)}</option>
        ))}
      </select>

      <div className="flex gap-1">
        <Button
          variant={player.isReady ? "ghost" : "primary"}
          className="flex-1"
          onClick={onToggleReady}
        >
          {player.isReady ? "取消准备" : "准备"}
        </Button>
        {canKick && <Button variant="danger" onClick={onKick}>清空</Button>}
      </div>
    </Card>
  );
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div className="mb-4 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded p-2">
      {msg}
    </div>
  );
}

function Loading() {
  return <main className="max-w-md mx-auto px-4 py-10 text-center text-slate-400">加载中…</main>;
}

function NotFound({ code, remote }: { code: string; remote: boolean }) {
  return (
    <main className="max-w-md mx-auto px-4 py-10 text-center space-y-3">
      <p className="text-slate-300">未找到房间 {code}。</p>
      <p className="text-xs text-slate-500">
        {remote ? "房间码可能有误，或房间已结束。" : "本地模式下房间数据仅存于创建它的浏览器内。"}
      </p>
      <Link href="/" className="text-blue-400 underline">返回首页</Link>
    </main>
  );
}
