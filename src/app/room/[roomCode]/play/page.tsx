"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useEnsureHydrated } from "@/components/store-hooks";
import { Button, Card, Badge, cls } from "@/components/ui";
import { GameMap } from "@/components/GameMap";
import type { GameRoom, Player } from "@/game/types";
import {
  submitAction,
  drawItemsFromRoom,
  drawFromTrash,
  useGoldDraw,
  claimAirdrop,
  discardItems,
} from "@/game/engine";
import { getInventoryWeight, getCarryLimit, isOverweight } from "@/game/inventory";
import { buildMoveContext, getReachableRooms, validateMove, type MovePreview } from "@/game/utils/movement";
import { getRole } from "@/game/config/roles";
import { getItemName } from "@/game/config/items";
import { getRoomLabel, getRoom, ROOMS } from "@/game/config/rooms";
import { getRoomFunction, getDrawLimit, isDrawRoom } from "@/game/config/roomFunctions";
import { FLOORS } from "@/game/config/floors";
import { PHASE_INFO } from "@/game/config/phases";
import { FOOD_WATER_START_ROUND } from "@/game/config/rounds";

const USABLE = ["pill", "wine", "adrenaline"];

const SPECIAL_LABEL: Record<string, string> = {
  helicopter: "直升机",
  portal: "传送室",
  trash_chute: "垃圾管道",
  rope: "绳索",
  shadow: "暗影上下楼",
};

export default function PlayPage() {
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

  const me = room.players.find((p) => p.id === myId);
  const seated = room.players.filter((p) => p.name);

  const run = (fn: (r: GameRoom) => GameRoom) => {
    setError("");
    try {
      apply(code, fn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">我的面板 · <span className="text-gold">{code}</span></h1>
        <Link href={`/room/${code}/board`}><Button variant="ghost">公共战况</Button></Link>
      </header>

      <Card title="选择我的身份" className="mb-4">
        <div className="flex flex-wrap gap-2">
          {seated.map((p) => (
            <Button key={p.id} variant={p.id === myId ? "gold" : "ghost"} onClick={() => setIdentity(code, p.id)}>
              {p.seatIndex + 1}. {p.name}
            </Button>
          ))}
        </div>
      </Card>

      {error && <div className="mb-4 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded p-2">{error}</div>}

      {!me ? <Card>请选择一个身份以查看私密面板。</Card> : <PrivatePanel room={room} me={me} run={run} />}
    </main>
  );
}

function PrivatePanel({ room, me, run }: { room: GameRoom; me: Player; run: (fn: (r: GameRoom) => GameRoom) => void }) {
  const isShadow = me.status === "shadow";
  const phase = PHASE_INFO[room.currentPhase];
  const weight = getInventoryWeight(me);
  const limit = getCarryLimit(me);
  const over = isOverweight(me);
  const isAction = room.currentPhase === "ACTION";

  const counts: Record<string, number> = {};
  for (const id of me.inventory) counts[id] = (counts[id] ?? 0) + 1;

  // 可达房间（行动阶段）
  const reachable = useMemo(
    () => (isAction && me.location ? getReachableRooms(buildMoveContext(me)) : []),
    [isAction, me]
  );
  const reachableIds = reachable.map((r) => r.roomId);

  const [toRoom, setToRoom] = useState("");
  const selected = isAction ? toRoom : me.submittedAction?.toRoom;
  const heliEligible = me.location === "202";

  return (
    <>
      <Card title="本轮状态" className="mb-4">
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <Stat label="轮次" value={`第 ${room.currentRound} 轮`} />
          <Stat label="阶段" value={phase?.label ?? room.currentPhase} />
          <Stat label="职业" value={getRole(me.roleId)?.name ?? "—"} />
          <Stat label="状态" value={isShadow ? "暗影" : me.reviveProtectedRound === room.currentRound ? "复活保护" : "存活"} tone={isShadow ? "shadow" : "toxic"} />
          <Stat label="生命值" value={`${me.hp} / ${me.maxHp}`} tone="blood" />
          <Stat label="顺位卡" value={me.orderCard ?? "—"} />
          <Stat label="武力 / 速度 / 负重" value={`${me.force} / ${me.speed} / ${me.load}`} />
          <Stat label="当前位置" value={me.location ? getRoomLabel(me.location) : "—"} />
        </div>
        <div className="mt-3 text-sm">
          <span className="text-xs text-slate-400">负重：</span>
          <span className={cls(over ? "text-red-400 font-semibold" : "text-slate-200")}>
            {weight} / {limit === Infinity ? "∞（次元口袋）" : limit}
          </span>
          {over && <span className="text-red-400 ml-2">超重！提交前需丢弃。</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1 items-center">
          <span className="text-xs text-slate-400">关键道具：</span>
          {["rope", "gasmask", "adrenaline", "rocket", "pocket", "gold"].filter((id) => counts[id]).map((id) => (
            <Badge key={id} tone="gold">{getItemName(id)}×{counts[id]}</Badge>
          ))}
          {heliEligible && <Badge tone="toxic">直升机资格（202）</Badge>}
        </div>
        <div className="mt-2">
          <span className="text-xs text-slate-400">我的道具：</span>
          {me.inventory.length === 0 ? <span className="text-xs text-slate-500">无</span> : (
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(counts).map(([id, n]) => <Badge key={id}>{getItemName(id)} ×{n}</Badge>)}
            </div>
          )}
        </div>
      </Card>

      <Card title="地图与房间对照" className="mb-4">
        {isAction && (
          <p className="text-xs text-slate-400 mb-2">
            当前速度 {me.speed}；绿色为本轮可到达房间（点击选择目标）。{isShadow ? "暗影可不经楼梯上下楼。" : ""}
          </p>
        )}
        <GameMap
          selectedRoomId={selected}
          currentPlayerRoomId={me.location ?? undefined}
          reachableRoomIds={isAction ? reachableIds : undefined}
          onPickRoom={isAction ? setToRoom : undefined}
          gasFloors={room.gasFloors}
          clearedGasRooms={room.clearedGasRooms}
          compact
        />
      </Card>

      <Card title="本轮行动">
        <p className="text-xs text-slate-400 mb-3">{phase?.description}</p>
        {!isAction ? (
          <p className="text-slate-400 text-sm">非行动阶段，暂不可提交行动。</p>
        ) : (
          <ActionArea
            room={room}
            me={me}
            isShadow={isShadow}
            over={over}
            counts={counts}
            run={run}
            reachable={reachable}
            reachableIds={reachableIds}
            toRoom={toRoom}
            setToRoom={setToRoom}
          />
        )}
      </Card>
    </>
  );
}

function ActionArea({
  room,
  me,
  isShadow,
  over,
  counts,
  run,
  reachable,
  reachableIds,
  toRoom,
  setToRoom,
}: {
  room: GameRoom;
  me: Player;
  isShadow: boolean;
  over: boolean;
  counts: Record<string, number>;
  run: (fn: (r: GameRoom) => GameRoom) => void;
  reachable: ReturnType<typeof getReachableRooms>;
  reachableIds: string[];
  toRoom: string;
  setToRoom: (id: string) => void;
}) {
  const submitted = me.submittedAction;
  const needWaterFood = room.currentRound >= FOOD_WATER_START_ROUND;

  const [gasVoteFloor, setGasVoteFloor] = useState(submitted?.gasVoteFloor ?? "");
  const [roomAction, setRoomAction] = useState(submitted?.roomAction ?? "");
  const [rocketTarget, setRocketTarget] = useState(submitted?.rocketTargetRoom ?? "");
  const [submitWater, setSubmitWater] = useState(submitted?.submitWater ?? false);
  const [submitFood, setSubmitFood] = useState(submitted?.submitFood ?? false);
  const [useCounts, setUseCounts] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const id of submitted?.useItems ?? []) init[id] = (init[id] ?? 0) + 1;
    return init;
  });

  const preview: MovePreview | null = useMemo(
    () => (toRoom ? validateMove(buildMoveContext(me), toRoom) : null),
    [toRoom, me]
  );
  const destFn = toRoom ? getRoomFunction(toRoom) : undefined;
  const hasRocket = me.inventory.includes("rocket");

  const buildUseItems = (): string[] => {
    const list: string[] = [];
    for (const [id, n] of Object.entries(useCounts)) for (let i = 0; i < n; i++) list.push(id);
    return list;
  };

  const doSubmit = () => {
    run((r) =>
      submitAction(r, me.id, {
        toRoom,
        gasVoteFloor: isShadow ? null : gasVoteFloor,
        roomAction: roomAction || undefined,
        useItems: buildUseItems(),
        rocketTargetRoom: rocketTarget || undefined,
        submitWater,
        submitFood,
      })
    );
  };

  // 可达房间按楼层分组
  const reachByFloor = FLOORS.map((f) => ({
    floor: f.label,
    rooms: reachable.filter((r) => getRoomFloor(r.roomId) === f.id),
  })).filter((g) => g.rooms.length > 0);

  return (
    <div className="space-y-4">
      <Field label={`目标房间（当前位置 ${me.location ? getRoomLabel(me.location) : "—"}，速度 ${me.speed}，必须移动）`}>
        {reachable.length === 0 ? (
          <p className="text-sm text-amber-300">没有可到达的房间（请检查速度或地图连接）。</p>
        ) : (
          <div className="space-y-2">
            {reachByFloor.map((g) => (
              <div key={g.floor}>
                <div className="text-[11px] text-slate-500 mb-1">{g.floor}</div>
                <div className="flex flex-wrap gap-1">
                  {g.rooms.map((r) => (
                    <button
                      key={r.roomId}
                      type="button"
                      onClick={() => { setToRoom(r.roomId); setRoomAction(""); }}
                      className={cls(
                        "text-xs px-2 py-1 rounded border",
                        toRoom === r.roomId ? "bg-gold/30 border-gold text-gold" : "bg-ink-700 border-ink-600 hover:brightness-125"
                      )}
                    >
                      {getRoomLabel(r.roomId)}
                      <span className="text-slate-500 ml-1">{r.distance}步</span>
                      {r.specialMoves.length > 0 && <span className="text-toxic ml-1">特</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Field>

      {preview && preview.ok && (
        <div className="bg-ink-700 border border-ink-600 rounded p-3 text-sm space-y-1">
          <div className="font-medium text-slate-200">移动预览</div>
          <div>目标：{getRoomLabel(preview.toRoom)} · 预计 {preview.steps} 步</div>
          <div className="text-slate-300">路径：{preview.path.map(getRoomLabel).join(" → ")}</div>
          {preview.specialMoves.length > 0 && (
            <div className="text-toxic">特殊移动：{Array.from(new Set(preview.specialMoves)).map((m) => SPECIAL_LABEL[m] ?? m).join("、")}</div>
          )}
          {preview.passesLaser && <div className="text-red-400">⚠ 经过/停留 102 激光室，确认后立即 -1 生命</div>}
        </div>
      )}
      {preview && !preview.ok && <div className="text-sm text-amber-300">{preview.reason}</div>}

      {!isShadow && destFn && (
        <Field label={`房间功能（${destFn.name}）`}>
          <select className="select" value={roomAction} onChange={(e) => setRoomAction(e.target.value)}>
            <option value="">不使用</option>
            {toRoom === "201" && <option value="gene">使用基因库：三项 +1</option>}
            {toRoom === "B101" && <option value="control_vote10">控制室：本轮毒气投票 1 票视为 10 票</option>}
            {toRoom !== "201" && toRoom !== "B101" && <option value="use">使用：{destFn.name}（结算时由房主核对）</option>}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">{destFn.effect}</p>
        </Field>
      )}

      {isShadow ? (
        <p className="text-sm text-purple-300">暗影：不投毒气、不用房间功能、不抽道具，仅提交移动终点；可不经楼梯上下楼；经过激光室不受伤害。</p>
      ) : (
        <Field label="毒气投票楼层">
          <select className="select" value={gasVoteFloor} onChange={(e) => setGasVoteFloor(e.target.value)}>
            <option value="">请选择</option>
            {FLOORS.map((f) => (
              <option key={f.id} value={f.id} disabled={room.gasFloors.includes(f.id)}>
                {f.label}{room.gasFloors.includes(f.id) ? "（已是毒气楼层）" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}

      {!isShadow && USABLE.some((id) => counts[id]) && (
        <Field label="本轮使用道具（结算阶段生效）">
          <div className="space-y-1">
            {USABLE.filter((id) => counts[id]).map((id) => (
              <div key={id} className="flex items-center gap-2 text-sm">
                <span className="w-28">{getItemName(id)}（持有 {counts[id]}）</span>
                <input type="number" min={0} max={counts[id]} className="w-20 bg-ink-700 border border-ink-600 rounded px-2 py-1"
                  value={useCounts[id] ?? 0}
                  onChange={(e) => setUseCounts((s) => ({ ...s, [id]: Math.max(0, Math.min(counts[id], parseInt(e.target.value, 10) || 0)) }))} />
              </div>
            ))}
          </div>
        </Field>
      )}

      {!isShadow && hasRocket && (
        <Field label="火箭筒袭击目标房间（可选）">
          <select className="select" value={rocketTarget} onChange={(e) => setRocketTarget(e.target.value)}>
            <option value="">不使用</option>
            {FLOORS.map((f) => (
              <optgroup key={f.id} label={f.label}>
                {roomsOfFloor(f.id).map((rid) => <option key={rid} value={rid}>{getRoomLabel(rid)}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
      )}

      {!isShadow && needWaterFood && (
        <Field label={`水粮上交计划（第 ${FOOD_WATER_START_ROUND} 轮起）`}>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={submitWater} onChange={(e) => setSubmitWater(e.target.checked)} disabled={!counts["water"]} />
              上交水（持有 {counts["water"] ?? 0}）
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={submitFood} onChange={(e) => setSubmitFood(e.target.checked)} disabled={!counts["food"]} />
              上交粮食（持有 {counts["food"] ?? 0}）
            </label>
          </div>
        </Field>
      )}

      <Button variant="primary" className="w-full" disabled={!toRoom || (preview ? !preview.ok : false)} onClick={doSubmit}>
        {submitted ? "更新并重新提交" : "确认移动并提交本轮行动"}
      </Button>

      {submitted && (
        <div className="text-sm space-y-1">
          <Badge tone="toxic">已提交</Badge>
          <p>目标房间：{getRoomLabel(submitted.toRoom)}（{submitted.stepsUsed ?? "?"} 步）</p>
          {submitted.path && <p className="text-slate-400">路径：{submitted.path.map(getRoomLabel).join(" → ")}</p>}
          {submitted.usedSpecialMove && <p className="text-toxic">特殊移动：{submitted.usedSpecialMove.map((m) => SPECIAL_LABEL[m] ?? m).join("、")}</p>}
          {submitted.gasVoteFloor ? <p>毒气投票：{submitted.gasVoteFloor}</p> : <p className="text-purple-300">未投毒气</p>}
          {submitted.useItems && submitted.useItems.length > 0 && <p>使用道具：{submitted.useItems.map(getItemName).join("、")}</p>}
          {submitted.rocketTargetRoom && <p>火箭筒目标：{getRoomLabel(submitted.rocketTargetRoom)}</p>}
        </div>
      )}

      {!isShadow && submitted && <RoomInteractions room={room} me={me} run={run} />}
      {over && <DiscardPanel me={me} run={run} />}
    </div>
  );
}

// 房间所属楼层（用于分组与火箭筒下拉）
function getRoomFloor(roomId: string): string {
  return getRoom(roomId)?.floor ?? "";
}
function roomsOfFloor(floorId: string): string[] {
  return ROOMS.filter((r) => r.floor === floorId).map((r) => r.id);
}

function RoomInteractions({ room, me, run }: { room: GameRoom; me: Player; run: (fn: (r: GameRoom) => GameRoom) => void }) {
  const target = me.submittedAction!.toRoom;
  const fn = getRoomFunction(target);
  const limit = getDrawLimit(target);
  const roomInv = room.roomInventories[target] ?? {};
  const invTotal = Object.values(roomInv).reduce((a, b) => a + b, 0);
  const [goldPick, setGoldPick] = useState("");

  const canDraw = isDrawRoom(target) && target !== "B503";
  const isTrash = target === "B503";
  const canGold = me.inventory.includes("gold") && isDrawRoom(target) && target !== "B206" && target !== "B503";
  const isHelipad = target === "202";
  const availableAirdrops = room.airdrops.filter((a) => !a.claimed);

  if (!fn) return null;

  return (
    <div className="border-t border-ink-600 pt-3 space-y-3">
      <p className="text-xs text-slate-400">目标房间功能：{fn.name} —— {fn.effect}</p>
      <p className="text-xs text-slate-500">房间当前库存：{invTotal} 张</p>

      {canDraw && <Button onClick={() => run((r) => drawItemsFromRoom(r, target, me.id, limit))}>抽卡（最多 {limit} 张）</Button>}
      {isTrash && <Button onClick={() => run((r) => drawFromTrash(r, me.id, 5))}>垃圾场抽卡（最多 5 张，非垃圾最多保留 2 张）</Button>}

      {canGold && (
        <div className="flex gap-2 items-center">
          <select className="select" value={goldPick} onChange={(e) => setGoldPick(e.target.value)}>
            <option value="">用金条额外选取…</option>
            {Object.entries(roomInv).filter(([id, n]) => id !== "gold" && n > 0).map(([id, n]) => (
              <option key={id} value={id}>{getItemName(id)}（{n}）</option>
            ))}
          </select>
          <Button variant="gold" disabled={!goldPick} onClick={() => run((r) => useGoldDraw(r, target, me.id, goldPick))}>使用金条</Button>
        </div>
      )}

      {isHelipad && (
        <div className="space-y-1">
          <p className="text-xs text-slate-400">可领取空投：</p>
          {availableAirdrops.length === 0 ? <p className="text-xs text-slate-500">暂无可领取空投。</p> : (
            <div className="flex flex-wrap gap-2">
              {availableAirdrops.map((a) => (
                <Button key={a.round} onClick={() => run((r) => claimAirdrop(r, me.id, a.round))}>
                  领取第 {a.round} 轮空投（{Object.entries(a.items).map(([id, n]) => `${getItemName(id)}×${n}`).join("、")}）
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiscardPanel({ me, run }: { me: Player; run: (fn: (r: GameRoom) => GameRoom) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const counts: Record<string, number> = {};
  for (const id of me.inventory) counts[id] = (counts[id] ?? 0) + 1;

  const toggle = (id: string) => {
    setPicked((p) => {
      const idx = p.indexOf(id);
      if (idx === -1) return [...p, id];
      const np = [...p]; np.splice(idx, 1); return np;
    });
  };
  const pickedCount: Record<string, number> = {};
  for (const id of picked) pickedCount[id] = (pickedCount[id] ?? 0) + 1;

  return (
    <div className="border border-red-700 bg-red-900/20 rounded p-3 space-y-2">
      <p className="text-sm text-red-300 font-semibold">超重：请选择要丢弃的道具（留在当前房间）</p>
      <div className="flex flex-wrap gap-1">
        {Object.entries(counts).map(([id, n]) => (
          <button key={id} className={cls("text-xs px-2 py-1 rounded border", (pickedCount[id] ?? 0) > 0 ? "bg-red-700 border-red-500 text-white" : "bg-ink-700 border-ink-600")} onClick={() => toggle(id)}>
            {getItemName(id)} ×{n}{(pickedCount[id] ?? 0) > 0 ? `（弃${pickedCount[id]}）` : ""}
          </button>
        ))}
      </div>
      <Button variant="danger" disabled={picked.length === 0} onClick={() => { run((r) => discardItems(r, me.id, picked)); setPicked([]); }}>
        确认丢弃 {picked.length} 张
      </Button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "blood" | "toxic" | "shadow" }) {
  const color = tone === "blood" ? "text-red-300" : tone === "toxic" ? "text-toxic" : tone === "shadow" ? "text-purple-300" : "text-slate-100";
  return (<div><div className="text-xs text-slate-500">{label}</div><div className={cls("font-medium", color)}>{value}</div></div>);
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="block text-xs text-slate-400 mb-1">{label}</label>{children}</div>);
}
function Center({ children }: { children: React.ReactNode }) {
  return <main className="max-w-md mx-auto px-4 py-10 text-center text-slate-400">{children}</main>;
}
