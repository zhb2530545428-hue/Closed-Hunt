"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useEnsureHydrated } from "@/components/store-hooks";
import { Button, Card, Badge, cls } from "@/components/ui";
import { GameMap } from "@/components/GameMap";
import type { GameRoom, Player, ResolutionStep } from "@/game/types";
import {
  goToPhase,
  generateResolutionPreview,
  confirmResolution,
  endGame,
  resetPlayerAction,
  allSubmitted,
  adjustHp,
  setPlayerStatus,
  addPublicLog,
  computeRanking,
  tallyGasVotes,
} from "@/game/engine";
import { getInventoryWeight } from "@/game/inventory";
import { getRole } from "@/game/config/roles";
import { getFloorLabel } from "@/game/config/floors";
import { getItemName } from "@/game/config/items";
import { getRoomLabel } from "@/game/config/rooms";
import { PHASE_INFO } from "@/game/config/phases";

export default function BoardPage() {
  const params = useParams<{ roomCode: string }>();
  const code = (params.roomCode as string)?.toUpperCase();
  const hydrated = useEnsureHydrated();

  const room = useGameStore((s) => s.rooms[code]);
  const myId = useGameStore((s) => s.identities[code]);
  const apply = useGameStore((s) => s.apply);
  const setIdentity = useGameStore((s) => s.setIdentity);
  const [error, setError] = useState("");

  if (!hydrated) return <Center>加载中…</Center>;
  if (!room) return <Center>未找到房间 {code}。<Link href="/" className="text-blue-400 underline ml-2">返回</Link></Center>;

  const isHost = myId === room.hostPlayerId;
  const seated = room.players.filter((p) => p.name);
  const phase = PHASE_INFO[room.currentPhase];

  const run = (fn: (r: GameRoom) => GameRoom) => {
    setError("");
    try {
      apply(code, fn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-bold">公共战况 · <span className="text-gold">{code}</span></h1>
        <div className="flex gap-2">
          <Link href={`/room/${code}/play`}><Button variant="gold">我的面板</Button></Link>
          <Link href={`/room/${code}`}><Button variant="ghost">大厅</Button></Link>
        </div>
      </header>

      {error && <div className="mb-4 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded p-2">{error}</div>}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="gold">第 {room.currentRound} 轮</Badge>
          <Badge tone="toxic">{phase?.label}</Badge>
          {room.currentPhase === "ACTION" && (
            <span className="text-sm text-slate-400">提交进度：{seated.filter((p) => p.submittedAction).length} / {seated.length}</span>
          )}
          {room.gasFloors.length > 0 && (
            <span className="text-sm">毒气楼层：{room.gasFloors.map(getFloorLabel).join("、")}</span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-2">{phase?.description}</p>
      </Card>

      <Card title="切换身份（本地测试）" className="mb-4">
        <div className="flex flex-wrap gap-2">
          {seated.map((p) => (
            <Button key={p.id} variant={p.id === myId ? "gold" : "ghost"} onClick={() => setIdentity(code, p.id)}>
              {p.seatIndex + 1}. {p.name}{p.id === room.hostPlayerId ? "（房主）" : ""}
            </Button>
          ))}
        </div>
      </Card>

      <Card title="地图" className="mb-4">
        <GameMap gasFloors={room.gasFloors} clearedGasRooms={room.clearedGasRooms} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PlayersBoard room={room} seated={seated} isHost={isHost} />
        <LogPanel room={room} />
      </div>

      {room.currentPhase === "GAME_OVER" && <RankingPanel room={room} />}

      {room.resolutionPreview && <PreviewPanel room={room} />}

      {isHost ? (
        <HostConsole room={room} seated={seated} run={run} />
      ) : (
        <Card title="房主控制台" className="mt-4">
          <p className="text-sm text-slate-400">仅房主可操作。切换身份为房主（{room.players.find((p) => p.id === room.hostPlayerId)?.name}）后可见。</p>
        </Card>
      )}
    </main>
  );
}

function PlayersBoard({ room, seated, isHost }: { room: GameRoom; seated: Player[]; isHost: boolean }) {
  return (
    <Card title="玩家">
      <div className="space-y-2">
        {seated.map((p) => {
          const counts: Record<string, number> = {};
          for (const id of p.inventory) counts[id] = (counts[id] ?? 0) + 1;
          return (
            <div key={p.id} className="bg-ink-700 rounded px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs">{p.seatIndex + 1}.</span>
                  <span className="font-medium">{p.name}</span>
                  {p.id === room.hostPlayerId && <span className="text-gold text-xs">房主</span>}
                  {p.status === "shadow" ? <Badge tone="shadow">暗影</Badge> : <Badge tone="toxic">存活</Badge>}
                  {p.reviveProtectedRound === room.currentRound && <Badge tone="gold">复活保护</Badge>}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-red-300">❤ {p.hp}/{p.maxHp}</span>
                  {room.currentPhase === "ACTION" && (p.submittedAction ? <Badge tone="toxic">已提交</Badge> : <Badge>未提交</Badge>)}
                </div>
              </div>
              {isHost && (
                <div className="text-[11px] text-slate-400 mt-1">
                  {getRole(p.roleId)?.name} · 负重 {getInventoryWeight(p)}/{p.load} ·
                  {p.inventory.length === 0 ? " 无道具" : " " + Object.entries(counts).map(([id, n]) => `${getItemName(id)}×${n}`).join("、")}
                  {p.submittedAction ? ` · 去 ${p.submittedAction.toRoom}` : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!isHost && <p className="text-[11px] text-slate-500 mt-2">玩家道具为私密信息，仅房主可见。</p>}
    </Card>
  );
}

function LogPanel({ room }: { room: GameRoom }) {
  const logs = [...room.publicLogs].reverse();
  return (
    <Card title="公开日志">
      <div className="space-y-1 max-h-[420px] overflow-y-auto text-sm">
        {logs.length === 0 && <p className="text-slate-500">暂无日志。</p>}
        {logs.map((l) => (
          <div key={l.id} className="text-slate-300">
            <span className="text-slate-500 text-xs mr-2">[R{l.round}·{PHASE_INFO[l.phase]?.label ?? l.phase}]</span>
            {l.message}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PreviewPanel({ room }: { room: GameRoom }) {
  const preview = room.resolutionPreview!;
  const nameOf = (id?: string) => room.players.find((p) => p.id === id)?.name ?? id ?? "";
  return (
    <Card title={`结算预览（第 ${preview.round} 轮）`} className="mt-4 border-gold/40">
      <p className="text-xs text-slate-400 mb-3">以下为系统按固定顺序计算的结果，房主核对后点击「确认应用结算」。</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {preview.steps.map((s: ResolutionStep) => (
          <div key={s.type} className="bg-ink-700 border border-ink-600 rounded p-3">
            <div className="font-medium mb-1">{s.title}</div>
            <div className="text-xs text-slate-300 space-y-0.5">
              {s.logs.map((m, i) => (<div key={i}>{m}</div>))}
            </div>
            {s.effects.some((e) => e.hpChange) && (
              <div className="mt-2 text-[11px] text-slate-400">
                {s.effects.filter((e) => e.hpChange).map((e, i) => (
                  <span key={i} className="mr-2">
                    {nameOf(e.playerId)} {e.hpChange! > 0 ? "+" : ""}{e.hpChange}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function HostConsole({ room, seated, run }: { room: GameRoom; seated: Player[]; run: (fn: (r: GameRoom) => GameRoom) => void }) {
  const [logText, setLogText] = useState("");
  const isResolution = room.currentPhase === "RESOLUTION";
  const isOver = room.currentPhase === "GAME_OVER";

  // 毒气投票实时统计（仅房主参考）
  const gas = tallyGasVotes(room.players, room.gasFloors);
  const rocketTargets = seated.filter((p) => p.status === "alive" && p.inventory.includes("rocket") && p.submittedAction?.rocketTargetRoom);

  return (
    <Card title="房主控制台" className="mt-4">
      <div className="flex flex-wrap gap-2 mb-4">
        <Button onClick={() => run((r) => goToPhase(r, "FREE"))} disabled={isOver}>进入自由阶段</Button>
        <Button onClick={() => run((r) => goToPhase(r, "ACTION"))} disabled={isOver}>进入行动阶段</Button>
        <Button onClick={() => run((r) => goToPhase(r, "RESOLUTION"))} disabled={isOver}>进入结算阶段</Button>
        <Button variant="gold" disabled={!isResolution} onClick={() => run((r) => generateResolutionPreview(r))}>生成结算预览</Button>
        <Button variant="primary" disabled={!isResolution || !room.resolutionPreview} onClick={() => run((r) => confirmResolution(r))}>
          确认应用结算 → {room.currentRound >= 6 ? "最终结算" : "下一轮"}
        </Button>
        <Button variant="danger" disabled={isOver} onClick={() => run((r) => endGame(r))}>结束游戏</Button>
      </div>

      {room.currentPhase === "ACTION" && (
        <p className="text-xs text-slate-400 mb-3">{allSubmitted(room) ? "所有玩家已提交，可进入结算阶段。" : "等待玩家提交行动……"}</p>
      )}

      {/* 参考信息 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="bg-ink-700 rounded p-2 text-xs">
          <div className="font-semibold text-slate-300 mb-1">毒气投票统计</div>
          {Object.keys(gas.tally).length === 0 ? <div className="text-slate-500">暂无投票</div> :
            Object.entries(gas.tally).sort((a, b) => b[1] - a[1]).map(([f, n]) => (
              <div key={f}>{getFloorLabel(f)}：{n} 票</div>
            ))}
          {gas.newFloors.length > 0 && <div className="text-toxic mt-1">预计新增毒气：{gas.newFloors.map(getFloorLabel).join("、")}</div>}
        </div>
        <div className="bg-ink-700 rounded p-2 text-xs">
          <div className="font-semibold text-slate-300 mb-1">火箭筒目标</div>
          {rocketTargets.length === 0 ? <div className="text-slate-500">无</div> :
            rocketTargets.map((p) => (
              <div key={p.id}>{p.name} → {getRoomLabel(p.submittedAction!.rocketTargetRoom!)}</div>
            ))}
        </div>
      </div>

      <h4 className="text-sm font-semibold text-slate-300 mb-2">手动修正玩家</h4>
      <div className="space-y-2 mb-4">
        {seated.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 bg-ink-700 rounded px-3 py-2 text-sm">
            <span className="w-24 truncate">{p.seatIndex + 1}. {p.name}</span>
            <span className="text-red-300">❤ {p.hp}</span>
            <Button className="px-2 py-1 min-h-0" onClick={() => run((r) => adjustHp(r, p.id, -1))}>-1</Button>
            <Button className="px-2 py-1 min-h-0" onClick={() => run((r) => adjustHp(r, p.id, +1))}>+1</Button>
            {p.status === "shadow" ? (
              <Button className="px-2 py-1 min-h-0" onClick={() => run((r) => setPlayerStatus(r, p.id, "alive"))}>设为存活</Button>
            ) : (
              <Button variant="danger" className="px-2 py-1 min-h-0" onClick={() => run((r) => setPlayerStatus(r, p.id, "shadow"))}>设为暗影</Button>
            )}
            {p.submittedAction && <Button className="px-2 py-1 min-h-0" onClick={() => run((r) => resetPlayerAction(r, p.id))}>重置提交</Button>}
          </div>
        ))}
      </div>

      <h4 className="text-sm font-semibold text-slate-300 mb-2">添加公开日志</h4>
      <div className="flex gap-2">
        <input className="select" value={logText} onChange={(e) => setLogText(e.target.value)} placeholder="输入要公开的信息" />
        <Button variant="primary" onClick={() => { if (!logText.trim()) return; run((r) => addPublicLog(r, logText)); setLogText(""); }}>添加</Button>
      </div>
    </Card>
  );
}

function RankingPanel({ room }: { room: GameRoom }) {
  const ranks = computeRanking(room);
  return (
    <Card title="最终排名（金魔方积分）" className="mt-4">
      <div className="space-y-1">
        {ranks.map((r) => {
          const p = room.players.find((x) => x.id === r.playerId)!;
          return (
            <div key={r.playerId} className="flex items-center justify-between bg-ink-700 rounded px-3 py-2 text-sm">
              <span>
                <span className="text-gold font-bold mr-2">#{r.rank}</span>
                {p.name}
                <span className="text-slate-400 ml-2">{getRole(p.roleId)?.name}</span>
                {p.status === "shadow" && <Badge tone="shadow">暗影</Badge>}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-red-300">❤ {p.hp}</span>
                <span className="text-gold">{r.points} 分</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">排名按规则 17.3/17.4；最终金条已自动兑换为生命值。</p>
    </Card>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="max-w-md mx-auto px-4 py-10 text-center text-slate-400">{children}</main>;
}
