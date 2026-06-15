"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useEnsureHydrated } from "@/components/store-hooks";
import { Button, Card, Badge, cls } from "@/components/ui";
import type { GameRoom, Player } from "@/game/types";
import {
  goToPhase,
  nextRound,
  endGame,
  setResolutionStep,
  resetPlayerAction,
  allSubmitted,
  allStepsConfirmed,
  adjustHp,
  setPlayerStatus,
  addPublicLog,
  basicRanking,
} from "@/game/engine";
import { getRole } from "@/game/config/roles";
import { getFloorLabel } from "@/game/config/floors";
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

  const run = (fn: (room: GameRoom) => GameRoom) => {
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
            <span className="text-sm text-slate-400">
              提交进度：{seated.filter((p) => p.submittedAction).length} / {seated.length}
            </span>
          )}
          {room.gasFloors.length > 0 && (
            <span className="text-sm">
              毒气楼层：{room.gasFloors.map(getFloorLabel).join("、")}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-2">{phase?.description}</p>
      </Card>

      {/* 身份切换（便于本地测试切到房主） */}
      <Card title="切换身份（本地测试）" className="mb-4">
        <div className="flex flex-wrap gap-2">
          {seated.map((p) => (
            <Button key={p.id} variant={p.id === myId ? "gold" : "ghost"} onClick={() => setIdentity(code, p.id)}>
              {p.seatIndex + 1}. {p.name}{p.id === room.hostPlayerId ? "（房主）" : ""}
            </Button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PlayersBoard room={room} seated={seated} />
        <LogPanel room={room} />
      </div>

      {room.currentPhase === "GAME_OVER" && <RankingPanel room={room} />}

      {room.currentPhase === "RESOLUTION" && (
        <ResolutionPanel
          room={room}
          isHost={isHost}
          onSet={(key, patch) => run((r) => setResolutionStep(r, key, patch))}
        />
      )}

      {isHost ? (
        <HostConsole room={room} seated={seated} run={run} />
      ) : (
        <Card title="房主控制台" className="mt-4">
          <p className="text-sm text-slate-400">
            仅房主可操作控制台。切换身份为房主（{room.players.find((p) => p.id === room.hostPlayerId)?.name}）后可见。
          </p>
        </Card>
      )}
    </main>
  );
}

function PlayersBoard({ room, seated }: { room: GameRoom; seated: Player[] }) {
  return (
    <Card title="玩家（公开信息）">
      <div className="space-y-2">
        {seated.map((p) => (
          <div key={p.id} className="flex items-center justify-between bg-ink-700 rounded px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs">{p.seatIndex + 1}.</span>
              <span className="font-medium">{p.name}</span>
              {p.id === room.hostPlayerId && <span className="text-gold text-xs">房主</span>}
              {p.status === "shadow" ? <Badge tone="shadow">暗影</Badge> : <Badge tone="toxic">存活</Badge>}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-red-300">❤ {p.hp}/{p.maxHp}</span>
              {room.currentPhase === "ACTION" && (
                p.submittedAction ? <Badge tone="toxic">已提交</Badge> : <Badge>未提交</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">不显示其他玩家道具、职业隐藏信息与精确移动路径。</p>
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

function ResolutionPanel({
  room,
  isHost,
  onSet,
}: {
  room: GameRoom;
  isHost: boolean;
  onSet: (key: string, patch: { confirmed?: boolean; hostNotes?: string }) => void;
}) {
  return (
    <Card title="结算步骤（固定顺序）" className="mt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {room.resolutionSteps.map((s) => (
          <div key={s.key} className={cls("rounded border p-3", s.confirmed ? "border-toxic/50 bg-toxic/5" : "border-ink-600 bg-ink-700")}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">{s.title}</span>
              {s.confirmed ? <Badge tone="toxic">已确认</Badge> : s.status === "auto" ? <Badge tone="gold">自动</Badge> : <Badge>待确认</Badge>}
            </div>
            <pre className="text-xs text-slate-300 whitespace-pre-wrap font-sans mb-2">{s.autoInfo}</pre>
            {isHost && (
              <>
                <input
                  className="select mb-2"
                  placeholder="主持人备注"
                  defaultValue={s.hostNotes}
                  onBlur={(e) => onSet(s.key, { hostNotes: e.target.value })}
                />
                <Button
                  variant={s.confirmed ? "ghost" : "primary"}
                  className="w-full"
                  onClick={() => onSet(s.key, { confirmed: !s.confirmed })}
                >
                  {s.confirmed ? "取消确认" : "确认此步骤"}
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function HostConsole({
  room,
  seated,
  run,
}: {
  room: GameRoom;
  seated: Player[];
  run: (fn: (room: GameRoom) => GameRoom) => void;
}) {
  const [logText, setLogText] = useState("");
  const canNext = room.currentPhase === "RESOLUTION" && allStepsConfirmed(room);

  return (
    <Card title="房主控制台" className="mt-4">
      <div className="flex flex-wrap gap-2 mb-4">
        <Button onClick={() => run((r) => goToPhase(r, "FREE"))} disabled={room.currentPhase === "GAME_OVER"}>进入自由阶段</Button>
        <Button onClick={() => run((r) => goToPhase(r, "ACTION"))} disabled={room.currentPhase === "GAME_OVER"}>进入行动阶段</Button>
        <Button onClick={() => run((r) => goToPhase(r, "RESOLUTION"))} disabled={room.currentPhase === "GAME_OVER"}>进入结算阶段</Button>
        <Button variant="gold" onClick={() => run((r) => nextRound(r))} disabled={!canNext}>
          进入下一轮 / 完成结算
        </Button>
        <Button variant="danger" onClick={() => run((r) => endGame(r))} disabled={room.currentPhase === "GAME_OVER"}>结束游戏</Button>
      </div>
      {room.currentPhase === "ACTION" && (
        <p className="text-xs text-slate-400 mb-3">
          {allSubmitted(room) ? "所有玩家已提交，可进入结算阶段。" : "等待玩家提交行动……"}
        </p>
      )}

      <h4 className="text-sm font-semibold text-slate-300 mb-2">手动修正玩家</h4>
      <div className="space-y-2 mb-4">
        {seated.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 bg-ink-700 rounded px-3 py-2 text-sm">
            <span className="w-28 truncate">{p.seatIndex + 1}. {p.name}</span>
            <span className="text-red-300">❤ {p.hp}</span>
            <Button className="px-2 py-1 min-h-0" onClick={() => run((r) => adjustHp(r, p.id, -1))}>-1</Button>
            <Button className="px-2 py-1 min-h-0" onClick={() => run((r) => adjustHp(r, p.id, +1))}>+1</Button>
            {p.status === "shadow" ? (
              <Button className="px-2 py-1 min-h-0" onClick={() => run((r) => setPlayerStatus(r, p.id, "alive"))}>设为存活</Button>
            ) : (
              <Button variant="danger" className="px-2 py-1 min-h-0" onClick={() => run((r) => setPlayerStatus(r, p.id, "shadow"))}>设为暗影</Button>
            )}
            {p.submittedAction && (
              <Button className="px-2 py-1 min-h-0" onClick={() => run((r) => resetPlayerAction(r, p.id))}>重置提交</Button>
            )}
            <span className="text-xs text-slate-500">
              {getRole(p.roleId)?.name} · 顺位 {p.orderCard ?? "—"}
              {p.submittedAction ? ` · 去 ${p.submittedAction.toRoom}` : ""}
            </span>
          </div>
        ))}
      </div>

      <h4 className="text-sm font-semibold text-slate-300 mb-2">添加公开日志</h4>
      <div className="flex gap-2">
        <input className="select" value={logText} onChange={(e) => setLogText(e.target.value)} placeholder="输入要公开的信息" />
        <Button
          variant="primary"
          onClick={() => {
            if (!logText.trim()) return;
            run((r) => addPublicLog(r, logText));
            setLogText("");
          }}
        >
          添加
        </Button>
      </div>
    </Card>
  );
}

function RankingPanel({ room }: { room: GameRoom }) {
  const ranks = basicRanking(room);
  return (
    <Card title="最终排名（金魔方积分）" className="mt-4">
      <div className="space-y-1">
        {ranks.map((r) => (
          <div key={r.player.id} className="flex items-center justify-between bg-ink-700 rounded px-3 py-2 text-sm">
            <span>
              <span className="text-gold font-bold mr-2">#{r.rank}</span>
              {r.player.name}
              <span className="text-slate-400 ml-2">{getRole(r.player.roleId)?.name}</span>
              {r.player.status === "shadow" && <Badge tone="shadow">暗影</Badge>}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-red-300">❤ {r.player.hp}</span>
              <span className="text-gold">{r.points} 分</span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        排名按规则 17.3：存活优先 → 生命值 → 武力；暗影按生前武力。金条兑换生命请房主在结束前手动结算。
      </p>
    </Card>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="max-w-md mx-auto px-4 py-10 text-center text-slate-400">{children}</main>;
}
