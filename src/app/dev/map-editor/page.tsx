"use client";

// 地图编辑器开发页（精简版）。访问：/dev/map-editor
//
// 职责仅限：编辑【已有房间】的位置、大小，以及房间之间的【逻辑连接】。
// - 坐标（mapLayout）只负责显示；连接（mapConnections）才负责移动规则。
// - 不在此设置出生/功能/抽卡/普通房间，不新增/删除房间（见规则配置 rooms.ts）。
// - 校验与寻路逻辑在 game/utils/mapEditor.ts，本页只做交互与展示。
//
// 数据持久化：编辑结果存 localStorage；可导出/导入 JSON。要应用到正式游戏，
// 见页面底部说明（手动把导出的连接回写 mapGraph.ts）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ROOMS, getRoomLabel } from "@/game/config/rooms";
import { DEFAULT_MAP_LAYOUT, MAP_CANVAS, type RoomLayout } from "@/game/config/mapLayout";
import {
  DEFAULT_MAP_CONNECTIONS,
  CONNECTION_TYPE_LABEL,
  makeConnectionId,
  type RoomConnection,
  type RoomConnectionType,
} from "@/game/config/mapConnections";
import { validateMapData, shortestPath, type MapIssue } from "@/game/utils/mapEditor";

const MAP_SRC = encodeURI("/禁闭逃杀_地图.png");
const STORAGE_KEY = "closed-hunt-map-editor-v1";
const MIN_SIZE = 16;

const TYPE_COLOR: Record<RoomConnectionType, string> = {
  adjacent: "#38bdf8",
  stairs: "#a78bfa",
  bridge: "#f59e0b",
  pipe: "#10b981",
  teleport: "#ec4899",
  helicopter: "#ef4444",
  special: "#94a3b8",
};

const TYPE_OPTIONS: RoomConnectionType[] = [
  "adjacent", "stairs", "bridge", "pipe", "teleport", "helicopter", "special",
];

interface SavedData {
  layout: RoomLayout[];
  connections: RoomConnection[];
}

/** 合并保存数据：保证 ROOMS 每个房间都有布局（缺失的补默认），丢弃未知房间布局。 */
function normalizeLayout(saved: RoomLayout[] | undefined): RoomLayout[] {
  const byId = new Map((saved ?? []).map((l) => [l.id, l]));
  return DEFAULT_MAP_LAYOUT.map((d) => {
    const s = byId.get(d.id);
    return s ? { ...d, ...s, name: d.name, floor: d.floor } : d;
  });
}

function loadSaved(): SavedData {
  if (typeof window === "undefined") {
    return { layout: DEFAULT_MAP_LAYOUT, connections: DEFAULT_MAP_CONNECTIONS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { layout: DEFAULT_MAP_LAYOUT, connections: DEFAULT_MAP_CONNECTIONS };
    const parsed = JSON.parse(raw) as SavedData;
    return {
      layout: normalizeLayout(parsed.layout),
      connections: Array.isArray(parsed.connections) ? parsed.connections : DEFAULT_MAP_CONNECTIONS,
    };
  } catch {
    return { layout: DEFAULT_MAP_LAYOUT, connections: DEFAULT_MAP_CONNECTIONS };
  }
}

export default function MapEditorPage() {
  const [layout, setLayout] = useState<RoomLayout[]>(DEFAULT_MAP_LAYOUT);
  const [connections, setConnections] = useState<RoomConnection[]>(DEFAULT_MAP_CONNECTIONS);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [selectedConn, setSelectedConn] = useState<string | null>(null);

  const [showBg, setShowBg] = useState(true);
  const [bgOpacity, setBgOpacity] = useState(0.6);
  const [showLabels, setShowLabels] = useState(true);

  // 连接模式：点房间依次填入新建连接的起点/终点
  const [connectMode, setConnectMode] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newType, setNewType] = useState<RoomConnectionType>("adjacent");
  const [newBidir, setNewBidir] = useState(true);
  const [newNote, setNewNote] = useState("");

  const [pathFrom, setPathFrom] = useState("B103");
  const [pathTo, setPathTo] = useState("B107");

  const canvasRef = useRef<HTMLDivElement>(null);

  // 初次加载读取本地存档（仅客户端）
  useEffect(() => {
    const s = loadSaved();
    setLayout(s.layout);
    setConnections(s.connections);
    setLoaded(true);
  }, []);

  const layoutById = useMemo(() => new Map(layout.map((l) => [l.id, l])), [layout]);
  const issues = useMemo(() => validateMapData(layout, connections), [layout, connections]);
  const path = useMemo(() => shortestPath(connections, pathFrom, pathTo), [connections, pathFrom, pathTo]);

  const markDirty = () => setDirty(true);

  const updateRoom = useCallback((id: string, patch: Partial<RoomLayout>) => {
    setLayout((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    markDirty();
  }, []);

  // —— 拖动 / 缩放 ——
  const drag = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: RoomLayout;
    scaleX: number;
    scaleY: number;
  } | null>(null);

  const scale = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: rect ? rect.width / MAP_CANVAS.width : 1,
      y: rect ? rect.height / MAP_CANVAS.height : 1,
    };
  };

  const onPointerDown = (e: React.PointerEvent, id: string, mode: "move" | "resize") => {
    e.stopPropagation();
    const room = layoutById.get(id);
    if (!room) return;
    setSelectedRoom(id);
    setSelectedConn(null);
    if (connectMode) {
      // 连接模式：点击只用于挑选起点/终点，不拖动
      if (!newFrom) setNewFrom(id);
      else if (!newTo && id !== newFrom) setNewTo(id);
      return;
    }
    const s = scale();
    drag.current = { id, mode, startX: e.clientX, startY: e.clientY, orig: { ...room }, scaleX: s.x, scaleY: s.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.scaleX;
    const dy = (e.clientY - d.startY) / d.scaleY;
    if (d.mode === "move") {
      const x = Math.max(0, Math.min(MAP_CANVAS.width - d.orig.width, Math.round(d.orig.x + dx)));
      const y = Math.max(0, Math.min(MAP_CANVAS.height - d.orig.height, Math.round(d.orig.y + dy)));
      updateRoom(d.id, { x, y });
    } else {
      const width = Math.max(MIN_SIZE, Math.round(d.orig.width + dx));
      const height = Math.max(MIN_SIZE, Math.round(d.orig.height + dy));
      updateRoom(d.id, { width, height });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current) {
      try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
    }
    drag.current = null;
  };

  // —— 连接增删改 ——
  const addConnection = () => {
    if (!newFrom || !newTo || newFrom === newTo) return;
    const id = makeConnectionId(newFrom, newTo, newType, newBidir);
    if (connections.some((c) => c.id === id)) {
      setSelectedConn(id);
      return;
    }
    setConnections((prev) => [
      ...prev,
      { id, from: newFrom, to: newTo, type: newType, bidirectional: newBidir, note: newNote.trim() || undefined },
    ]);
    markDirty();
    setSelectedConn(id);
    setNewFrom("");
    setNewTo("");
    setNewNote("");
  };

  const updateConnection = (id: string, patch: Partial<RoomConnection>) => {
    setConnections((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        next.id = makeConnectionId(next.from, next.to, next.type, next.bidirectional);
        return next;
      })
    );
    markDirty();
    if (patch.type !== undefined || patch.bidirectional !== undefined) {
      // id 可能变化，重新选中
      setSelectedConn((cur) => {
        const c = connections.find((x) => x.id === cur);
        if (!c) return cur;
        const next = { ...c, ...patch };
        return makeConnectionId(next.from, next.to, next.type, next.bidirectional);
      });
    }
  };

  const deleteConnection = (id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setSelectedConn((cur) => (cur === id ? null : cur));
    markDirty();
  };

  // —— 存档 / 导入导出 ——
  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ layout, connections }));
    setDirty(false);
  };
  const reload = () => {
    const s = loadSaved();
    setLayout(s.layout);
    setConnections(s.connections);
    setDirty(false);
    setSelectedRoom(null);
    setSelectedConn(null);
  };
  const resetDefault = () => {
    if (!confirm("恢复为初始草稿？未保存的修改将丢失（不影响已保存存档，除非随后再点保存）。")) return;
    setLayout(DEFAULT_MAP_LAYOUT);
    setConnections(DEFAULT_MAP_CONNECTIONS);
    setDirty(true);
  };

  const download = (filename: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<SavedData>;
        if (parsed.layout) setLayout(normalizeLayout(parsed.layout));
        if (parsed.connections) setConnections(parsed.connections);
        setDirty(true);
        alert("导入成功（记得点保存写入本地存档）。");
      } catch (err) {
        alert("导入失败：JSON 解析错误。" + String(err));
      }
    };
    reader.readAsText(file);
  };

  const selectedRoomData = selectedRoom ? layoutById.get(selectedRoom) : undefined;
  const selectedConnData = connections.find((c) => c.id === selectedConn);
  const roomConnections = selectedRoom
    ? connections.filter((c) => c.from === selectedRoom || c.to === selectedRoom)
    : [];

  if (!loaded) return <main className="p-6 text-sm text-slate-400">加载中…</main>;

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-5 text-sm">
      <header className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold">地图编辑器 · /dev/map-editor {dirty && <span className="text-amber-400 text-xs">（未保存）</span>}</h1>
        <div className="flex gap-3 items-center">
          <Link href="/dev/map-checker" className="text-blue-400 underline text-xs">校验页</Link>
          <Link href="/" className="text-blue-400 underline text-xs">首页</Link>
        </div>
      </header>

      {/* 工具栏 */}
      <div className="flex flex-wrap gap-2 items-center mb-3 bg-ink-800 border border-ink-600 rounded p-2 text-xs">
        <button onClick={save} className="px-2 py-1 bg-emerald-600 rounded">保存</button>
        <button onClick={reload} className="px-2 py-1 bg-ink-600 rounded">重新加载</button>
        <button onClick={resetDefault} className="px-2 py-1 bg-ink-600 rounded">恢复默认草稿</button>
        <span className="w-px h-4 bg-ink-600" />
        <button onClick={() => download("map.json", { layout, connections })} className="px-2 py-1 bg-blue-600 rounded">导出 JSON</button>
        <button onClick={() => download("mapLayout.json", layout)} className="px-2 py-1 bg-ink-600 rounded">导出布局</button>
        <button onClick={() => download("mapConnections.json", connections)} className="px-2 py-1 bg-ink-600 rounded">导出连接</button>
        <label className="px-2 py-1 bg-ink-600 rounded cursor-pointer">
          导入 JSON
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
        <span className="w-px h-4 bg-ink-600" />
        <label className="flex items-center gap-1"><input type="checkbox" checked={showBg} onChange={(e) => setShowBg(e.target.checked)} />底图</label>
        <label className="flex items-center gap-1">透明度
          <input type="range" min={0} max={1} step={0.05} value={bgOpacity} onChange={(e) => setBgOpacity(+e.target.value)} />
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />房名</label>
        <label className={`flex items-center gap-1 ${connectMode ? "text-pink-400" : ""}`}>
          <input type="checkbox" checked={connectMode} onChange={(e) => { setConnectMode(e.target.checked); setNewFrom(""); setNewTo(""); }} />连接模式（点两个房间）
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* 画布 */}
        <div
          ref={canvasRef}
          className="relative w-full border border-ink-600 rounded overflow-hidden bg-ink-900 select-none"
          style={{ aspectRatio: `${MAP_CANVAS.width} / ${MAP_CANVAS.height}` }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={() => { setSelectedRoom(null); setSelectedConn(null); }}
        >
          {showBg && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={MAP_SRC} alt="参考底图" className="absolute inset-0 w-full h-full object-fill pointer-events-none" style={{ opacity: bgOpacity }} />
          )}

          {/* 连接线 */}
          <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${MAP_CANVAS.width} ${MAP_CANVAS.height}`} preserveAspectRatio="none">
            <defs>
              {TYPE_OPTIONS.map((t) => (
                <marker key={t} id={`arrow-${t}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill={TYPE_COLOR[t]} />
                </marker>
              ))}
            </defs>
            {connections.map((c) => {
              const a = layoutById.get(c.from);
              const b = layoutById.get(c.to);
              if (!a || !b) return null;
              const x1 = a.x + a.width / 2, y1 = a.y + a.height / 2;
              const x2 = b.x + b.width / 2, y2 = b.y + b.height / 2;
              const sel = c.id === selectedConn;
              return (
                <line
                  key={c.id}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={TYPE_COLOR[c.type]}
                  strokeWidth={sel ? 5 : 2.5}
                  strokeDasharray={c.needReview ? "8 5" : undefined}
                  markerEnd={c.bidirectional ? undefined : `url(#arrow-${c.type})`}
                  className="cursor-pointer"
                  style={{ pointerEvents: "stroke" }}
                  onClick={(e) => { e.stopPropagation(); setSelectedConn(c.id); setSelectedRoom(null); }}
                />
              );
            })}
          </svg>

          {/* 房间格子 */}
          {layout.map((r) => {
            const sel = r.id === selectedRoom;
            const isNewFrom = r.id === newFrom;
            const isNewTo = r.id === newTo;
            return (
              <div
                key={r.id}
                onPointerDown={(e) => onPointerDown(e, r.id, "move")}
                style={{
                  left: `${(r.x / MAP_CANVAS.width) * 100}%`,
                  top: `${(r.y / MAP_CANVAS.height) * 100}%`,
                  width: `${(r.width / MAP_CANVAS.width) * 100}%`,
                  height: `${(r.height / MAP_CANVAS.height) * 100}%`,
                }}
                className={[
                  "absolute box-border border rounded flex flex-col items-center justify-center text-center leading-none cursor-move",
                  sel ? "border-gold bg-gold/30 z-20" :
                  isNewFrom ? "border-pink-400 bg-pink-500/30 z-10" :
                  isNewTo ? "border-pink-300 bg-pink-400/30 z-10" :
                  "border-white/50 bg-black/35 hover:bg-black/50",
                ].join(" ")}
              >
                <span className="text-[10px] font-semibold text-white">{r.id}</span>
                {showLabels && r.name && <span className="text-[8px] text-white/80">{r.name}</span>}
                {sel && (
                  <div
                    onPointerDown={(e) => onPointerDown(e, r.id, "resize")}
                    className="absolute -right-1 -bottom-1 w-3 h-3 bg-gold border border-white rounded-sm cursor-se-resize z-30"
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* 侧栏 */}
        <div className="space-y-3">
          {/* 选中房间 */}
          <Panel title="选中房间">
            {selectedRoomData ? (
              <div className="space-y-2 text-xs">
                <div className="font-semibold text-sm">{getRoomLabel(selectedRoomData.id)}</div>
                <div className="text-slate-400">楼层 {selectedRoomData.floor}</div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="x" value={selectedRoomData.x} onChange={(v) => updateRoom(selectedRoomData.id, { x: v })} />
                  <NumField label="y" value={selectedRoomData.y} onChange={(v) => updateRoom(selectedRoomData.id, { y: v })} />
                  <NumField label="宽" value={selectedRoomData.width} min={MIN_SIZE} onChange={(v) => updateRoom(selectedRoomData.id, { width: Math.max(MIN_SIZE, v) })} />
                  <NumField label="高" value={selectedRoomData.height} min={MIN_SIZE} onChange={(v) => updateRoom(selectedRoomData.id, { height: Math.max(MIN_SIZE, v) })} />
                </div>
                <div className="font-semibold mt-2">该房间的连接（{roomConnections.length}）</div>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {roomConnections.map((c) => (
                    <button key={c.id} onClick={() => { setSelectedConn(c.id); }} className="block w-full text-left px-2 py-1 rounded bg-ink-700 hover:bg-ink-600">
                      <span style={{ color: TYPE_COLOR[c.type] }}>●</span> {c.from}{c.bidirectional ? "↔" : "→"}{c.to}（{CONNECTION_TYPE_LABEL[c.type]}）{c.needReview && " ⚑"}
                    </button>
                  ))}
                  {roomConnections.length === 0 && <div className="text-amber-300">无连接（孤立房间）</div>}
                </div>
              </div>
            ) : (
              <div className="text-slate-400 text-xs">点击地图上的房间进行选择。</div>
            )}
          </Panel>

          {/* 新建连接 */}
          <Panel title="新建连接">
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <RoomSelect label="起点" value={newFrom} onChange={setNewFrom} />
                <RoomSelect label="终点" value={newTo} onChange={setNewTo} />
              </div>
              <div className="grid grid-cols-2 gap-2 items-end">
                <label className="block">类型
                  <select value={newType} onChange={(e) => setNewType(e.target.value as RoomConnectionType)} className="w-full bg-ink-700 border border-ink-600 rounded px-1 py-0.5">
                    {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{CONNECTION_TYPE_LABEL[t]}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={newBidir} onChange={(e) => setNewBidir(e.target.checked)} />双向</label>
              </div>
              <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="备注（单向建议填写）" className="w-full bg-ink-700 border border-ink-600 rounded px-1 py-0.5" />
              <button onClick={addConnection} disabled={!newFrom || !newTo || newFrom === newTo} className="w-full px-2 py-1 bg-blue-600 rounded disabled:opacity-40">添加连接</button>
              <p className="text-slate-400">开启「连接模式」后，依次点击两个房间可自动填入起点/终点。</p>
            </div>
          </Panel>

          {/* 选中连接 */}
          {selectedConnData && (
            <Panel title="选中连接">
              <div className="space-y-2 text-xs">
                <div className="font-semibold">{selectedConnData.from}{selectedConnData.bidirectional ? "↔" : "→"}{selectedConnData.to}</div>
                <label className="block">类型
                  <select value={selectedConnData.type} onChange={(e) => updateConnection(selectedConnData.id, { type: e.target.value as RoomConnectionType })} className="w-full bg-ink-700 border border-ink-600 rounded px-1 py-0.5">
                    {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{CONNECTION_TYPE_LABEL[t]}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={selectedConnData.bidirectional} onChange={(e) => updateConnection(selectedConnData.id, { bidirectional: e.target.checked })} />双向</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!selectedConnData.needReview} onChange={(e) => updateConnection(selectedConnData.id, { needReview: e.target.checked || undefined })} />needReview（待人工确认）</label>
                <input value={selectedConnData.note ?? ""} onChange={(e) => updateConnection(selectedConnData.id, { note: e.target.value || undefined })} placeholder="备注" className="w-full bg-ink-700 border border-ink-600 rounded px-1 py-0.5" />
                <button onClick={() => deleteConnection(selectedConnData.id)} className="w-full px-2 py-1 bg-red-700 rounded">删除连接</button>
              </div>
            </Panel>
          )}

          {/* 路径检查 */}
          <Panel title="最短路径检查（按连接图）">
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <RoomSelect label="起点" value={pathFrom} onChange={setPathFrom} />
                <RoomSelect label="终点" value={pathTo} onChange={setPathTo} />
              </div>
              {path ? (
                <div className="space-y-1">
                  <div>步数：<span className="text-toxic">{path.steps}</span></div>
                  <div className="text-slate-300">经过：{path.path.map(getRoomLabel).join(" → ")}</div>
                  <div>连接类型：{path.edgeTypes.map((t) => CONNECTION_TYPE_LABEL[t]).join("、") || "—"}</div>
                </div>
              ) : (
                <div className="text-amber-300">不可达（连接图中无路径）。</div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* 校验结果 */}
      <div className="mt-4">
        <Panel title={`地图校验（${issues.filter((i) => i.level === "error").length} 错误 / ${issues.filter((i) => i.level === "warn").length} 警告）`}>
          {issues.length === 0 ? (
            <div className="text-toxic text-xs">通过：无错误、无警告。</div>
          ) : (
            <ul className="text-xs space-y-0.5 max-h-60 overflow-auto">
              {issues.map((it, i) => (
                <li key={i} className={it.level === "error" ? "text-red-400" : "text-amber-300"}>
                  [{it.level === "error" ? "错误" : "警告"}] {it.message}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* 说明 */}
      <div className="mt-4 text-[11px] text-slate-400 leading-relaxed bg-ink-800 border border-ink-600 rounded p-3">
        <p>· 坐标（布局）只负责显示；连接才负责移动规则。两者数据分别在 <code>mapLayout.ts</code> / <code>mapConnections.ts</code>。</p>
        <p>· 编辑后点「保存」写入浏览器 localStorage；「导出 JSON」下载完整数据，「导入 JSON」从文件恢复。</p>
        <p>· 应用到正式游戏：把导出的连接按类型回写 <code>mapGraph.ts</code> 的 HORIZONTAL/STAIRS/BRIDGES 与特殊移动常量，运行 <code>npm test</code> 复测；坐标可回写 <code>mapLayout.ts</code>。本编辑器不自动改写正式游戏数据，避免破坏已稳定流程。</p>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-ink-800 border border-ink-600 rounded p-3">
      <h2 className="font-semibold mb-2 text-sm">{title}</h2>
      {children}
    </section>
  );
}

function NumField({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <label className="block">{label}
      <input type="number" min={min} value={value} onChange={(e) => onChange(Math.round(+e.target.value))} className="w-full bg-ink-700 border border-ink-600 rounded px-1 py-0.5" />
    </label>
  );
}

function RoomSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-ink-700 border border-ink-600 rounded px-1 py-0.5">
        <option value="">—</option>
        {ROOMS.map((r) => <option key={r.id} value={r.id}>{getRoomLabel(r.id)}</option>)}
      </select>
    </label>
  );
}
