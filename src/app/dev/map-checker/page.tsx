"use client";

// 地图校验开发页（v1.0.1 §2）。仅用于核对地图坐标、最短路径、步数与可疑连接。
// 步数/可达性全部来自 mapGraph + utils/movement（图结构）；图片与坐标只做展示。
// 访问：/dev/map-checker

import { useMemo, useState } from "react";
import Link from "next/link";
import { ROOMS, getRoomLabel } from "@/game/config/rooms";
import { ROOM_COORDS } from "@/game/config/mapCoords";
import { validateMapGraph, MAP_NODES } from "@/game/config/mapGraph";
import {
  validateMove,
  findShortestPath,
  getReachableRooms,
  pathTriggersLaser,
  type MoveContext,
  type MoveType,
} from "@/game/utils/movement";

const MAP_SRC = encodeURI("/禁闭逃杀_地图.png");

const SPECIAL_LABEL: Record<MoveType, string> = {
  normal: "普通",
  rope: "绳索",
  shadow: "暗影上下楼",
  helicopter: "直升机",
  trash_chute: "垃圾管道",
  portal: "传送室",
};

export default function MapCheckerPage() {
  const [from, setFrom] = useState("B103");
  const [to, setTo] = useState("B107");
  const [pick, setPick] = useState<"from" | "to">("from");

  const [shadow, setShadow] = useState(false);
  const [rope, setRope] = useState(false);
  const [heli, setHeli] = useState(false);
  const [adrenaline, setAdrenaline] = useState(false);
  const [speed, setSpeed] = useState(5);

  const graphErrors = useMemo(() => validateMapGraph(), []);

  const ctx: MoveContext = useMemo(
    () => ({
      fromRoomId: from,
      speed: adrenaline ? 10 : speed,
      status: shadow ? "shadow" : "alive",
      hasRope: !shadow && rope,
      heliEligible: heli && from === "202",
    }),
    [from, speed, adrenaline, shadow, rope, heli]
  );

  const preview = useMemo(() => validateMove(ctx, to), [ctx, to]);
  const shortest = useMemo(() => findShortestPath(ctx, to), [ctx, to]);
  const reachable = useMemo(() => new Set(getReachableRooms(ctx).map((r) => r.roomId)), [ctx]);

  const onPick = (roomId: string) => {
    if (pick === "from") {
      setFrom(roomId);
      setPick("to");
    } else {
      setTo(roomId);
      setPick("from");
    }
  };

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">地图校验工具 · /dev/map-checker</h1>
        <Link href="/" className="text-blue-400 underline text-sm">首页</Link>
      </header>

      <div className="mb-4 text-sm bg-ink-800 border border-ink-600 rounded p-3 space-y-1">
        <p>坐标为 display-only 估算（mapCoords.ts），可能与图片有偏差，需手工微调；步数与连接由 mapGraph 图结构计算。</p>
        <p>
          图结构自检：{graphErrors.length === 0 ? (
            <span className="text-toxic">通过（房间齐全、邻接双向）</span>
          ) : (
            <span className="text-red-400">{graphErrors.length} 处问题：{graphErrors.join("；")}</span>
          )}
        </p>
        <p className="text-slate-400">
          点击地图房间：先选「起点」再选「终点」（当前点击将设为 <span className="text-gold">{pick === "from" ? "起点" : "终点"}</span>）。
        </p>
      </div>

      {/* 玩家状态切换 */}
      <div className="mb-4 flex flex-wrap gap-3 items-center text-sm bg-ink-800 border border-ink-600 rounded p-3">
        <label className="flex items-center gap-1">速度
          <input type="number" min={0} max={10} className="w-16 bg-ink-700 border border-ink-600 rounded px-1" value={speed} disabled={adrenaline} onChange={(e) => setSpeed(Math.max(0, Math.min(10, +e.target.value)))} />
        </label>
        <Toggle on={adrenaline} set={setAdrenaline} label="肾上腺素（速度=10）" />
        <Toggle on={shadow} set={setShadow} label="暗影（不经楼梯上下楼）" />
        <Toggle on={rope} set={setRope} label="持有绳索" />
        <Toggle on={heli} set={setHeli} label="直升机资格（起点须 202）" />
      </div>

      {/* 地图叠加坐标框 */}
      <div className="relative w-full border border-ink-600 rounded overflow-hidden mb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MAP_SRC} alt="禁闭逃杀地图" className="w-full h-auto block" />
        {ROOMS.map((r) => {
          const c = ROOM_COORDS[r.id];
          if (!c) return null;
          const isFrom = r.id === from;
          const isTo = r.id === to;
          const onPath = shortest?.includes(r.id);
          const canReach = reachable.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id)}
              title={`${getRoomLabel(r.id)}（${MAP_NODES[r.id]?.floor}）`}
              style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
              className={[
                "absolute text-[9px] leading-none flex items-center justify-center rounded border px-0.5 text-center",
                isFrom ? "bg-blue-500/50 border-blue-300 text-white" :
                isTo ? "bg-gold/60 border-gold text-white" :
                onPath ? "bg-emerald-500/40 border-emerald-300 text-white" :
                canReach ? "bg-emerald-500/15 border-emerald-400/60 text-emerald-100" :
                "bg-black/30 border-white/30 text-white/80",
              ].join(" ")}
            >
              {r.id}
            </button>
          );
        })}
      </div>

      {/* 结果 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-ink-800 border border-ink-600 rounded p-3 text-sm space-y-1">
          <div className="font-semibold mb-1">起点 {getRoomLabel(from)} → 终点 {getRoomLabel(to)}</div>
          <div className="text-slate-400">忽略速度的最短路径（图结构）：</div>
          {shortest ? (
            <>
              <div>步数：{shortest.length - 1}</div>
              <div className="text-slate-300">经过：{shortest.map(getRoomLabel).join(" → ")}</div>
              <div>是否经过 102 激光室：{pathTriggersLaser(shortest, ctx.status) ? <span className="text-red-400">是</span> : "否"}</div>
            </>
          ) : (
            <div className="text-amber-300">不可达（无连接路径）。</div>
          )}
        </div>

        <div className="bg-ink-800 border border-ink-600 rounded p-3 text-sm space-y-1">
          <div className="font-semibold mb-1">当前速度 {ctx.speed} 下是否可达</div>
          {preview.ok ? (
            <>
              <div className="text-toxic">可达，消耗 {preview.steps} 步</div>
              <div className="text-slate-300">路径：{preview.path.map(getRoomLabel).join(" → ")}</div>
              <div>特殊移动：{preview.specialMoves.length ? Array.from(new Set(preview.specialMoves)).map((m) => SPECIAL_LABEL[m]).join("、") : "无（普通相邻/楼梯/廊桥）"}</div>
              <div>经过 102 激光室：{preview.passesLaser ? <span className="text-red-400">是</span> : "否"}</div>
            </>
          ) : (
            <div className="text-amber-300">{preview.reason}</div>
          )}
        </div>
      </div>

      {/* 邻接表（便于核对连接） */}
      <div className="mt-4 bg-ink-800 border border-ink-600 rounded p-3 text-xs">
        <div className="font-semibold mb-2">起点 {getRoomLabel(from)} 的直接相邻（楼梯/廊桥/相邻）</div>
        <div className="text-slate-300">{(MAP_NODES[from]?.neighbors ?? []).map(getRoomLabel).join("、") || "无"}</div>
      </div>
    </main>
  );
}

function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1 cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
}
