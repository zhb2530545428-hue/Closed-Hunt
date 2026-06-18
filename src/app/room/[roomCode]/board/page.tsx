"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useEnsureHydrated, useWatchRoom } from "@/components/store-hooks";
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
  setPlayerLocation,
  setPlayerGenes,
  adjustPlayerItem,
  setOrderCard,
  adjustRoleUses,
  toggleGasFloor,
  toggleClearedRoom,
  cancelTrade,
  missingSettlementConfirmers,
} from "@/game/engine";
import type { SnapshotMeta } from "@/store/sync";
import { getRole } from "@/game/config/roles";
import { FLOORS, getFloorLabel } from "@/game/config/floors";
import { getItemName, ITEMS } from "@/game/config/items";
import { getRoomLabel, ROOMS } from "@/game/config/rooms";
import { PHASE_INFO } from "@/game/config/phases";
import { TOTAL_ROUNDS, formatRoundLabel } from "@/game/config/rounds";
import { formatPlayerName, roleWithNick } from "@/game/utils/names";

export default function BoardPage() {
  const params = useParams<{ roomCode: string }>();
  const code = (params.roomCode as string)?.toUpperCase();
  const hydrated = useEnsureHydrated();
  useWatchRoom(code);

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
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (msg.includes("未确认结算资源选择")) window.alert(msg);
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
          <Badge tone="gold">{formatRoundLabel(room.currentRound)}</Badge>
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
              {roleWithNick(p)}{p.id === room.hostPlayerId ? "（房主）" : ""}
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

      {/* §4：结算预览即「房主裁判视图」，仅房主可见；确认后才按可见性分发为公开/私密/裁判日志。 */}
      {room.resolutionPreview && isHost && <PreviewPanel room={room} />}

      {isHost ? (
        <HostConsole room={room} seated={seated} run={run} code={code} />
      ) : (
        <Card title="房主控制台" className="mt-4">
          <p className="text-sm text-slate-400">仅房主可操作。切换身份为房主（{room.players.find((p) => p.id === room.hostPlayerId)?.name}）后可见。</p>
        </Card>
      )}
    </main>
  );
}

function PlayersBoard({ room, seated }: { room: GameRoom; seated: Player[]; isHost: boolean }) {
  // §12：按本轮顺位升序（暗影无顺位卡，排末尾）。准备阶段无顺位则按座位号。
  const ordered = [...seated].sort((a, b) => {
    const oa = a.orderCard ?? 999;
    const ob = b.orderCard ?? 999;
    return oa - ob || a.seatIndex - b.seatIndex;
  });
  const isAction = room.currentPhase === "ACTION";
  return (
    <Card title="玩家（按本轮顺位）">
      <div className="space-y-2">
        {ordered.map((p) => (
            <div key={p.id} className="bg-ink-700 rounded px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs w-10">
                    {p.status === "shadow" ? "暗影" : p.orderCard != null ? `顺位${p.orderCard}` : `#${p.seatIndex + 1}`}
                  </span>
                  <span className="font-medium">{getRole(p.roleId)?.name ?? "未定角色"}</span>
                  <span className="text-slate-400 text-xs">（{p.name}）</span>
                  {p.id === room.hostPlayerId && <span className="text-gold text-xs">房主</span>}
                  {p.status === "shadow" ? <Badge tone="shadow">暗影</Badge> : <Badge tone="toxic">存活</Badge>}
                  {p.reviveProtectedRound === room.currentRound && <Badge tone="gold">复活保护</Badge>}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-red-300">❤ {p.hp}/{p.maxHp}</span>
                  {isAction && (p.endedAction ? <Badge tone="toxic">已行动</Badge> : <Badge>待行动</Badge>)}
                </div>
              </div>
            </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">位置、移动目标和手牌为私密信息；房主可在下方裁判工具中查看完整明细。</p>
    </Card>
  );
}

function LogPanel({ room }: { room: GameRoom }) {
  // §13：仅展示公开日志；行动阶段产生的私密日志（移动/抽卡/技能）不在公共看板出现。
  const logs = room.publicLogs.filter((l) => l.visibility === "public");
  const grouped = groupPublicLogs(logs);
  return (
    <Card title="公开日志">
      <p className="text-[11px] text-slate-500 mb-1">行动阶段的移动/抽卡/技能为私密信息，结算后才会公开。</p>
      <div className="space-y-2 max-h-[420px] overflow-y-auto text-sm">
        {logs.length === 0 && <p className="text-slate-500">暂无日志。</p>}
        {grouped.map((g) => (
          <div key={g.key} className="bg-ink-700/70 border border-ink-600 rounded p-2">
            <div className="text-xs text-gold mb-1">{g.title}</div>
            <div className="space-y-1">
              {g.items.map((l) => (
                <div key={l.id} className="text-slate-300">{l.message}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const LOG_PHASE_LABEL: Record<string, string> = {
  initial_spawn_resolution: "首轮出生结算",
  free_phase: "自由阶段",
  action_phase: "行动阶段",
  resolution_room: "结算阶段：房间事件",
  resolution_combat: "结算阶段：战斗 / 乱斗",
  resolution_shadow: "结算阶段：暗影",
  resolution_rocket: "结算阶段：火箭筒",
  resolution_gas: "结算阶段：毒气",
  resolution_supply: "结算阶段：水粮",
  resolution_item_status: "结算阶段：道具 / 状态",
  resolution_death_revival: "结算阶段：死亡 / 复活",
  final: "最终结算",
};

function fallbackLogPhase(l: GameRoom["publicLogs"][number]): string {
  if (l.logPhase) return l.logPhase;
  if (l.phase === "SPAWN_COMBAT") return "initial_spawn_resolution";
  if (l.phase === "FREE") return "free_phase";
  if (l.phase === "ACTION") return "action_phase";
  if (l.phase === "GAME_OVER") return "final";
  return "resolution_item_status";
}

function groupPublicLogs(logs: GameRoom["publicLogs"]) {
  const groups = new Map<string, { key: string; title: string; items: GameRoom["publicLogs"] }>();
  for (const l of logs) {
    const phaseKey = fallbackLogPhase(l);
    const key = `${l.round}:${phaseKey}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: `${formatRoundLabel(l.round)} · ${LOG_PHASE_LABEL[phaseKey] ?? PHASE_INFO[l.phase]?.label ?? l.phase}`,
        items: [],
      });
    }
    groups.get(key)!.items.push(l);
  }
  return Array.from(groups.values()).reverse();
}

function PreviewPanel({ room }: { room: GameRoom }) {
  const preview = room.resolutionPreview!;
  const nameOf = (id?: string) => {
    const p = room.players.find((x) => x.id === id);
    return p ? formatPlayerName(p, "host") : id ?? "";
  };
  return (
    <Card title={`结算预览 · 房主裁判视图（${formatRoundLabel(preview.round)}）`} className="mt-4 border-gold/40">
      <p className="text-xs text-slate-400 mb-3">
        以下为完整裁判视图（含票数明细与玩家私密信息），仅房主可见。核对后点击「确认应用结算」，确认后按公开 / 私密 / 裁判分层落地。
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {preview.steps.map((s: ResolutionStep) => (
          <div key={s.type} className="bg-ink-700 border border-ink-600 rounded p-3">
            <div className="font-medium mb-1">{s.title}</div>
            <div className="text-xs text-slate-300 space-y-0.5">
              {s.logs.map((m, i) => (<div key={i}>{m}</div>))}
            </div>
            {(s.hostLogs ?? []).length > 0 && (
              <div className="text-[11px] text-amber-300 space-y-0.5 mt-1">
                {s.hostLogs!.map((m, i) => (<div key={i}>🔒 {m}</div>))}
              </div>
            )}
            {(s.privateLogs ?? []).length > 0 && (
              <div className="text-[11px] text-purple-300 space-y-0.5 mt-1">
                {s.privateLogs!.map((pl, i) => (<div key={i}>👤 {nameOf(pl.playerId)}：{pl.text}</div>))}
              </div>
            )}
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

function HostConsole({ room, seated, run, code }: { room: GameRoom; seated: Player[]; run: (fn: (r: GameRoom) => GameRoom) => void; code: string }) {
  const [logText, setLogText] = useState("");
  const isSpawnCombat = room.currentPhase === "SPAWN_COMBAT";
  const isResolution = room.currentPhase === "RESOLUTION";
  const canPreview = isSpawnCombat || isResolution;
  const isOver = room.currentPhase === "GAME_OVER";

  // 毒气投票实时统计（仅房主参考）
  const gas = tallyGasVotes(room.players, room.gasFloors);
  const rocketTargets = seated.filter((p) => p.status === "alive" && p.inventory.includes("rocket") && p.submittedAction?.rocketTargetRoom);
  const missingConfirmers = room.currentPhase === "RESOLUTION" ? missingSettlementConfirmers(room) : [];

  return (
    <Card title="房主控制台" className="mt-4">
      <div className="flex flex-wrap gap-2 mb-4">
        <Button onClick={() => run((r) => goToPhase(r, "FREE"))} disabled={isOver}>进入自由阶段</Button>
        <Button onClick={() => run((r) => goToPhase(r, "ACTION"))} disabled={isOver}>进入行动阶段</Button>
        <Button onClick={() => run((r) => goToPhase(r, "RESOLUTION"))} disabled={isOver}>进入结算阶段</Button>
        <Button variant="gold" disabled={!canPreview} onClick={() => run((r) => generateResolutionPreview(r))}>
          {isSpawnCombat ? "生成首轮出生战斗预览" : "生成结算预览"}
        </Button>
        <Button variant="primary" disabled={!canPreview || !room.resolutionPreview} onClick={() => run((r) => confirmResolution(r))}>
          {isSpawnCombat ? "确认首轮结算 → 第 1 轮" : `确认应用结算 → ${room.currentRound >= TOTAL_ROUNDS ? "最终结算" : "下一轮"}`}
        </Button>
        <Button variant="danger" disabled={isOver} onClick={() => run((r) => endGame(r))}>结束游戏</Button>
      </div>

      {missingConfirmers.length > 0 && (
        <div className="mb-3 text-xs text-amber-300 bg-amber-900/20 border border-amber-700 rounded p-2">
          等待结算资源确认：{missingConfirmers.map(roleWithNick).join("、")}
        </div>
      )}

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
              <div key={p.id}>{roleWithNick(p)} → {getRoomLabel(p.submittedAction!.rocketTargetRoom!)}</div>
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
      <div className="flex gap-2 mb-4">
        <input className="select" value={logText} onChange={(e) => setLogText(e.target.value)} placeholder="输入要公开的信息" />
        <Button variant="primary" onClick={() => { if (!logText.trim()) return; run((r) => addPublicLog(r, logText)); setLogText(""); }}>添加</Button>
      </div>

      <JudgeLogPanel room={room} />
      <TradesAdminPanel room={room} run={run} />
      <AdvancedCorrectionPanel room={room} seated={seated} run={run} />
      <SnapshotPanel code={code} />
      <ExportImportPanel room={room} code={code} />
    </Card>
  );
}

/** 房主裁判日志（§4 C）：仅房主可见的完整明细——毒气票数、各玩家私密结算信息。 */
function JudgeLogPanel({ room }: { room: GameRoom }) {
  const logs = room.publicLogs.filter((l) => l.visibility === "host" || l.visibility === "private").reverse();
  const nameOf = (id?: string) => {
    const p = room.players.find((x) => x.id === id);
    return p ? formatPlayerName(p, "host") : id ?? "";
  };
  return (
    <details className="mb-3 bg-ink-700 rounded">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-300">
        房主裁判日志 · 含票数 / 玩家私密（{logs.length}）
      </summary>
      <div className="px-3 pb-3 space-y-1 max-h-72 overflow-y-auto">
        {logs.length === 0 && <p className="text-xs text-slate-500">暂无裁判明细。</p>}
        {logs.map((l) => (
          <div key={l.id} className="text-xs">
            <span className="text-slate-500 mr-1">[{formatRoundLabel(l.round)}]</span>
            {l.visibility === "host" ? (
              <span className="text-amber-300">🔒</span>
            ) : (
              <span className="text-purple-300">👤{l.playerId ? ` ${nameOf(l.playerId)}` : ""}</span>
            )}
            <span className="ml-1 text-slate-300">{l.message}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

/** 房主：待处理交易管理（取消异常交易）。 */
function TradesAdminPanel({ room, run }: { room: GameRoom; run: (fn: (r: GameRoom) => GameRoom) => void }) {
  const pending = room.trades.filter((t) => t.status === "pending");
  const nameOf = (id: string) => {
    const p = room.players.find((x) => x.id === id);
    return p ? roleWithNick(p) : id;
  };
  if (pending.length === 0) return null;
  return (
    <details className="mb-3 bg-ink-700 rounded">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-300">待处理交易（{pending.length}）</summary>
      <div className="px-3 pb-3 space-y-1">
        {pending.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-xs">
            <span>{nameOf(t.fromPlayerId)} → {nameOf(t.toPlayerId)}：{[...t.offerItems.map(getItemName), ...(t.offerOrderCard ? ["顺位卡"] : [])].join("、") || "（空）"}</span>
            <Button className="px-2 py-1 min-h-0" onClick={() => run((r) => cancelTrade(r, t.id))}>取消</Button>
          </div>
        ))}
      </div>
    </details>
  );
}

/** 房主：高级纠错（位置/基因/道具/顺位/技能次数/毒气/解毒）。 */
function AdvancedCorrectionPanel({ room, seated, run }: { room: GameRoom; seated: Player[]; run: (fn: (r: GameRoom) => GameRoom) => void }) {
  return (
    <details className="mb-3 bg-ink-700 rounded">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-300">高级纠错工具</summary>
      <div className="px-3 pb-3 space-y-3">
        {/* 毒气楼层 / 解毒 */}
        <div>
          <div className="text-xs text-slate-400 mb-1">毒气楼层（点击切换）</div>
          <div className="flex flex-wrap gap-1">
            {FLOORS.map((f) => (
              <button key={f.id} type="button" onClick={() => run((r) => toggleGasFloor(r, f.id))}
                className={cls("text-xs px-2 py-1 rounded border", room.gasFloors.includes(f.id) ? "bg-toxic/30 border-toxic text-toxic" : "bg-ink-800 border-ink-600")}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {/* 逐人纠错 */}
        {seated.map((p) => (
          <PlayerCorrectionRow key={p.id} room={room} p={p} run={run} />
        ))}
      </div>
    </details>
  );
}

function PlayerCorrectionRow({ room, p, run }: { room: GameRoom; p: Player; run: (fn: (r: GameRoom) => GameRoom) => void }) {
  const [loc, setLoc] = useState(p.location ?? "");
  const [force, setForce] = useState(p.force);
  const [speed, setSpeed] = useState(p.speed);
  const [load, setLoad] = useState(p.load);
  const [item, setItem] = useState("");
  return (
    <div className="border border-ink-600 rounded p-2 text-xs space-y-2">
      <div className="font-medium text-slate-200">{p.seatIndex + 1}. {p.name} · {getRole(p.roleId)?.name}</div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-slate-400">位置</span>
        <select className="bg-ink-800 border border-ink-600 rounded px-1 py-0.5" value={loc} onChange={(e) => setLoc(e.target.value)}>
          {ROOMS.map((r) => <option key={r.id} value={r.id}>{getRoomLabel(r.id)}</option>)}
        </select>
        <Button className="px-2 py-0.5 min-h-0" onClick={() => run((r) => setPlayerLocation(r, p.id, loc))}>设</Button>
        <span className="text-slate-400 ml-2">顺位</span>
        <Button className="px-2 py-0.5 min-h-0" onClick={() => run((r) => setOrderCard(r, p.id, (p.orderCard ?? 0) - 1 || null))}>-</Button>
        <span>{p.orderCard ?? "—"}</span>
        <Button className="px-2 py-0.5 min-h-0" onClick={() => run((r) => setOrderCard(r, p.id, (p.orderCard ?? 0) + 1))}>+</Button>
        {getRole(p.roleId)?.maxUses != null && (
          <>
            <span className="text-slate-400 ml-2">技能次数 {p.roleUses ?? 0}</span>
            <Button className="px-2 py-0.5 min-h-0" onClick={() => run((r) => adjustRoleUses(r, p.id, -1))}>-</Button>
            <Button className="px-2 py-0.5 min-h-0" onClick={() => run((r) => adjustRoleUses(r, p.id, +1))}>+</Button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-slate-400">基因</span>
        武<input type="number" className="w-12 bg-ink-800 border border-ink-600 rounded px-1" value={force} onChange={(e) => setForce(+e.target.value)} />
        速<input type="number" className="w-12 bg-ink-800 border border-ink-600 rounded px-1" value={speed} onChange={(e) => setSpeed(+e.target.value)} />
        负<input type="number" className="w-12 bg-ink-800 border border-ink-600 rounded px-1" value={load} onChange={(e) => setLoad(+e.target.value)} />
        <Button className="px-2 py-0.5 min-h-0" onClick={() => run((r) => setPlayerGenes(r, p.id, { force, speed, load }))}>设</Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-slate-400">道具</span>
        <select className="bg-ink-800 border border-ink-600 rounded px-1 py-0.5" value={item} onChange={(e) => setItem(e.target.value)}>
          <option value="">选择…</option>
          {ITEMS.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
        </select>
        <Button className="px-2 py-0.5 min-h-0" disabled={!item} onClick={() => run((r) => adjustPlayerItem(r, p.id, item, +1))}>+1</Button>
        <Button className="px-2 py-0.5 min-h-0" disabled={!item} onClick={() => run((r) => adjustPlayerItem(r, p.id, item, -1))}>-1</Button>
      </div>
    </div>
  );
}

/** 房主：快照查看与回滚。 */
function SnapshotPanel({ code }: { code: string }) {
  const listSnapshots = useGameStore((s) => s.listSnapshots);
  const rollback = useGameStore((s) => s.rollback);
  const [snaps, setSnaps] = useState<SnapshotMeta[]>([]);
  const [msg, setMsg] = useState("");

  const refresh = async () => {
    try { setSnaps(await listSnapshots(code)); setMsg(""); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const doRollback = async (i: number) => {
    if (!window.confirm("确认回滚到该快照？当前进度将被覆盖。")) return;
    try { await rollback(code, i); setMsg("已回滚。"); await refresh(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <details className="mb-3 bg-ink-700 rounded">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-300">阶段快照 / 回滚</summary>
      <div className="px-3 pb-3 space-y-2">
        <Button className="px-2 py-1 min-h-0" onClick={refresh}>刷新快照列表</Button>
        {msg && <p className="text-xs text-amber-300">{msg}</p>}
        {snaps.length === 0 ? <p className="text-xs text-slate-500">点击刷新查看最近快照（每次阶段切换自动保存）。</p> : (
          <div className="space-y-1">
            {snaps.map((s) => (
              <div key={s.index} className="flex items-center justify-between text-xs">
                <span>{s.label} · {new Date(s.createdAt).toLocaleTimeString()}</span>
                <Button className="px-2 py-0.5 min-h-0" onClick={() => doRollback(s.index)}>回滚到此</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

/** 房主：导出/导入房间 JSON。 */
function ExportImportPanel({ room, code }: { room: GameRoom; code: string }) {
  const apply = useGameStore((s) => s.apply);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");

  const doExport = () => {
    const json = JSON.stringify(room, null, 2);
    setText(json);
    navigator.clipboard?.writeText(json).catch(() => {});
    setMsg("已导出到文本框并复制到剪贴板。");
  };
  const doImport = () => {
    try {
      const parsed = JSON.parse(text) as GameRoom;
      if (parsed.roomCode !== room.roomCode) throw new Error("房间码不匹配，拒绝导入。");
      apply(code, () => parsed);
      setMsg("已导入并应用。");
    } catch (e) {
      setMsg("导入失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <details className="mb-1 bg-ink-700 rounded">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-300">导出 / 导入房间状态</summary>
      <div className="px-3 pb-3 space-y-2">
        <div className="flex gap-2">
          <Button className="px-2 py-1 min-h-0" onClick={doExport}>导出当前状态</Button>
          <Button className="px-2 py-1 min-h-0" variant="danger" onClick={doImport} disabled={!text.trim()}>导入并覆盖</Button>
        </div>
        {msg && <p className="text-xs text-amber-300">{msg}</p>}
        <textarea className="w-full h-32 bg-ink-800 border border-ink-600 rounded p-2 text-[11px] font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="房间状态 JSON" />
      </div>
    </details>
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
                <span className="text-slate-400 text-xs">武{p.force}/速{p.speed}/负{p.load}</span>
                <span className="text-red-300">❤ {p.hp}</span>
                <span className="text-gold">{r.points} 分</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">排名按规则 17.3/17.4；最终金条已自动兑换为生命值。完整事件见下方公开日志，可在房主控制台导出房间状态作复盘。</p>
    </Card>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="max-w-md mx-auto px-4 py-10 text-center text-slate-400">{children}</main>;
}
