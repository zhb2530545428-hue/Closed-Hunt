"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useEnsureHydrated, useWatchRoom } from "@/components/store-hooks";
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
  createTrade,
  respondTrade,
  cancelTrade,
  pendingTradesFor,
  endTurn,
  currentTurnPlayerId,
  reviseAction,
  skipDraw,
  chooseGiftGene,
} from "@/game/engine";
import type { RoleSkillInput } from "@/game/types";
import { getInventoryWeight, getCarryLimit, isOverweight } from "@/game/inventory";
import { buildMoveContext, getReachableRooms, validateMove, normalStepDistance, type MovePreview } from "@/game/utils/movement";
import { getRole, roleMaxUses } from "@/game/config/roles";
import { getItemName } from "@/game/config/items";
import { getRoomLabel, getRoom, ROOMS } from "@/game/config/rooms";
import { getRoomFunction, getDrawLimit, isDrawRoom, isRoomFunctionAvailable } from "@/game/config/roomFunctions";
import { FLOORS } from "@/game/config/floors";
import { PHASE_INFO } from "@/game/config/phases";
import { TOTAL_ROUNDS, formatRoundLabel } from "@/game/config/rounds";
import { roleWithNick } from "@/game/utils/names";

const USABLE = ["pill", "juice", "adrenaline"];

const SPECIAL_LABEL: Record<string, string> = {
  helicopter: "直升机",
  portal: "传送室",
  trash_chute: "垃圾管道",
  rope: "绳索",
  shadow: "暗影上下楼",
};

/** 玩家展示标签：优先角色名（昵称辅助）。v1.0.2 §6：对局内减少玩家 ID 干扰。 */
function playerLabel(p: Player): string {
  return roleWithNick(p);
}

export default function PlayPage() {
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

      <Card title="选择我的身份（本地热座测试用；远程模式各玩各的）" className="mb-4">
        <div className="flex flex-wrap gap-2">
          {seated.map((p) => (
            <Button key={p.id} variant={p.id === myId ? "gold" : "ghost"} onClick={() => setIdentity(code, p.id)}>
              {playerLabel(p)}
            </Button>
          ))}
        </div>
      </Card>

      {error && <div className="mb-4 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded p-2">{error}</div>}

      <TurnOrderCard room={room} myId={myId} />

      {!me ? <Card>请选择一个身份以查看私密面板。</Card> : (
        // §10：以 玩家+轮次+阶段 为 key，切换玩家时整面板重挂载，清空上一名玩家的本地输入残留。
        <PrivatePanel key={`${me.id}:${room.currentRound}:${room.currentPhase}`} room={room} me={me} run={run} />
      )}
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

  // §7：是否轮到我行动。暗影无顺位卡，可在行动阶段自由行动直到「结束行动」。
  const turnId = currentTurnPlayerId(room);
  const isMyTurn = !me.endedAction && (turnId === me.id || (me.status === "shadow" && isAction));
  const turnPlayer = room.players.find((p) => p.id === turnId);

  return (
    <>
      <Card title="本轮状态" className="mb-4">
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <Stat label="轮次" value={formatRoundLabel(room.currentRound)} />
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

      {me.forcedRoom && isAction && (
        <div className="mb-4 text-sm text-purple-200 bg-purple-900/30 border border-purple-700 rounded p-2">
          你被催眠：本轮必须前往 <span className="font-semibold">{getRoomLabel(me.forcedRoom)}</span>。
        </div>
      )}

      <RoleStatusCard me={me} />

      {me.pendingGiftFrom && <GiftGeneChoiceCard room={room} me={me} run={run} />}

      {room.currentPhase === "FREE" && <TradePanel room={room} me={me} run={run} />}

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
        ) : me.endedAction ? (
          <div className="text-sm text-slate-300 space-y-1">
            <Badge tone="toxic">已结束本轮行动</Badge>
            <p className="text-slate-400">本轮行动已锁定，不可更改。如需更正请房主在控制台重置你的提交。</p>
            {me.submittedAction && <p>目标房间：{getRoomLabel(me.submittedAction.toRoom)}</p>}
          </div>
        ) : !isMyTurn ? (
          <div className="text-sm text-amber-300">
            还没轮到你行动。当前应由 {turnPlayer ? playerLabel(turnPlayer) : "—"} 行动，请按顺位等待。
          </div>
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

      <PrivateLogCard room={room} me={me} />
    </>
  );
}

/**
 * 私密记录（§4 B / §13）：仅本人可见的移动/抽卡/技能信息，以及上一轮结算的私密结果
 * （如自己被黑客锁房间、果汁/技能私密结果），结算后才对本人展示，不进公共日志。
 */
function PrivateLogCard({ room, me }: { room: GameRoom; me: Player }) {
  const logs = room.publicLogs
    .filter(
      (l) =>
        l.visibility === "private" &&
        l.playerId === me.id &&
        (l.round === room.currentRound || l.round === room.currentRound - 1)
    )
    .reverse();
  if (logs.length === 0) return null;
  return (
    <Card title="私密记录（仅你可见：本轮 + 上一轮结算）" className="mt-4">
      <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
        {logs.map((l) => (
          <div key={l.id} className="text-slate-300">
            <span className="text-slate-500 text-xs mr-2">[{formatRoundLabel(l.round)}]</span>
            {l.message}
          </div>
        ))}
      </div>
    </Card>
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
  const [roleSkill, setRoleSkill] = useState<RoleSkillInput | undefined>(submitted?.roleSkill);

  const preview: MovePreview | null = useMemo(
    () => (toRoom ? validateMove(buildMoveContext(me), toRoom) : null),
    [toRoom, me]
  );
  const destFn = toRoom ? getRoomFunction(toRoom) : undefined;
  const hasRocket = me.inventory.includes("rocket");
  // §8：饮品师按瓶数分配目标，未为每瓶选择目标前不可确认。
  const juiceUseCount = useCounts["juice"] ?? 0;
  const juiceTargetsIncomplete =
    me.roleId === "bartender" &&
    juiceUseCount > 0 &&
    roleSkill?.type === "juice" &&
    (roleSkill.juiceAssignments ?? []).slice(0, juiceUseCount).some((a) => !a.targetPlayerId);

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
        roleSkill: isShadow ? undefined : roleSkill,
      })
    );
  };

  // 可达房间按楼层分组
  const reachByFloor = FLOORS.map((f) => ({
    floor: f.label,
    rooms: reachable.filter((r) => getRoomFloor(r.roomId) === f.id),
  })).filter((g) => g.rooms.length > 0);

  // §7.1：水粮为「预交下一轮」——最后一轮（第6轮）后无下一轮，故不再询问。
  const showWaterFoodPrepay = !isShadow && room.currentRound < TOTAL_ROUNDS;
  const nextRoundLabel = formatRoundLabel(room.currentRound + 1);
  const gasMissing = !isShadow && !gasVoteFloor;

  // §7.2：到达可抽卡房间必须先处理抽卡（抽卡或放弃）才能进入「结算准备区」。
  // 抽卡期间待上交的水粮 / 待使用的道具仍占负重，不能提前交出后再多抽——故按此顺序门控。
  const drawTarget = submitted?.toRoom;
  const drawClosed = drawTarget ? !isRoomFunctionAvailable(drawTarget, room) : false;
  const drawStock = drawTarget
    ? Object.values(room.roomInventories[drawTarget] ?? {}).reduce((a, b) => a + b, 0)
    : 0;
  const mustHandleDraw =
    !!submitted &&
    !drawClosed &&
    !!drawTarget &&
    isDrawRoom(drawTarget) &&
    drawStock > 0 &&
    !submitted.hasDrawnFromRoom &&
    !submitted.drawSkipped;

  // 行动末尾统一提交：道具使用 / 火箭筒 / 水粮预交 / 毒气投票 /（饮品师）果汁分配。
  const revisePatch = () => ({
    useItems: buildUseItems(),
    rocketTargetRoom: rocketTarget || undefined,
    submitWater,
    submitFood,
    gasVoteFloor: isShadow ? null : gasVoteFloor || null,
    roleSkill: me.roleId === "bartender" ? roleSkill : undefined,
  });

  // §7.2 行动 UI 顺序：① 身份（上方）② 位置/速度/可达 ③ 选择并确认移动
  // ④ 抽卡 ⑤ 抽到结果 ⑥ 背包更新 ⑦~⑩ 下一轮准备（水/粮/药/果汁/肾上腺素，0 也显示禁用）
  // ⑪ 毒气投票 ⑫ 黄色结束行动。各区块顺次向下出现，确认移动后不跳回顶部。
  const usableLabel: Record<string, string> = {
    pill: "药片（本轮结算回血）",
    juice: "果汁（本轮结算掷骰）",
    adrenaline: "肾上腺素（下一轮生效）",
  };

  return (
    <div className="space-y-4">
      {!submitted ? (
        <>
          {/* 步骤 2-3：选择并确认移动目标 */}
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
              {preview.passesLaser && <div className="text-red-400">⚠ 经过/停留 102 激光室，结算阶段将 -1 生命</div>}
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

          {/* 移动阶段主动技能（化学家/催眠/预言/慈善/侦探/黑客/猎犬）。饮品师果汁分配在抽卡后的准备区。 */}
          {!isShadow && me.roleId !== "bartender" && (
            <RoleSkillField room={room} me={me} value={roleSkill} onChange={setRoleSkill} counts={counts} juiceUseCount={0} />
          )}

          {isShadow && (
            <p className="text-sm text-purple-300">暗影：不投毒气、不用房间功能、不抽道具，仅提交移动终点；可不经楼梯上下楼；经过激光室不受伤害。</p>
          )}

          <Button variant="primary" className="w-full" disabled={!toRoom || over || (preview ? !preview.ok : false)} onClick={doSubmit}>
            确认移动并提交本轮行动
          </Button>
        </>
      ) : (
        <>
          {/* 已提交移动摘要 */}
          <div className="text-sm space-y-1">
            <Badge tone="toxic">已提交移动（不可更改，可继续抽卡/用房间功能）</Badge>
            <p>目标房间：{getRoomLabel(submitted.toRoom)}（{submitted.stepsUsed ?? "?"} 步）</p>
            {submitted.path && <p className="text-slate-400">路径：{submitted.path.map(getRoomLabel).join(" → ")}</p>}
            {submitted.usedSpecialMove && <p className="text-toxic">特殊移动：{submitted.usedSpecialMove.map((m) => SPECIAL_LABEL[m] ?? m).join("、")}</p>}
            {submitted.triggeredEffects?.some((t) => t.includes("激光")) && (
              <p className="text-red-300">⚠ 本轮路径经过 102 激光室，结算阶段将 -1 生命（行动阶段不公开）。</p>
            )}
          </div>

          {/* 步骤 4-5：到达后强制处理抽卡，并即时显示抽到内容 */}
          {!isShadow && <RoomInteractions room={room} me={me} run={run} />}

          {isShadow ? (
            <p className="text-sm text-purple-300">暗影：仅提交移动终点即可，无需抽卡/投票，等待房主结算或点「结束本轮行动」。</p>
          ) : mustHandleDraw ? (
            <p className="text-[11px] text-amber-300 border-t border-ink-600 pt-2">
              请先在上方完成抽卡（抽卡或选择「放弃抽卡」）。抽卡期间待上交的水粮 / 待使用道具仍占负重，处理完抽卡后才会出现「结算准备区」与毒气投票。
            </p>
          ) : (
            <>
              {/* 步骤 6：背包 / 负重在上方「本轮状态」卡实时更新 */}
              <p className="text-[11px] text-slate-500 border-t border-ink-600 pt-2">背包 / 负重已在上方「本轮状态」卡更新。下面是结算准备区。</p>

              {/* 步骤 7-10：下一轮准备区（按钮无论有无道具都显示，数量为 0 时禁用） */}
              <Field label="结算准备：道具使用（药片/果汁本轮结算生效，肾上腺素下一轮生效）">
                <div className="space-y-1">
                  {USABLE.map((id) => {
                    const have = counts[id] ?? 0;
                    return (
                      <div key={id} className="flex items-center gap-2 text-sm">
                        <span className="w-44">{usableLabel[id]}（持有 {have}）</span>
                        <input
                          type="number"
                          min={0}
                          max={have}
                          disabled={have === 0}
                          className="w-20 bg-ink-700 border border-ink-600 rounded px-2 py-1 disabled:opacity-40"
                          value={useCounts[id] ?? 0}
                          onChange={(e) => setUseCounts((s) => ({ ...s, [id]: Math.max(0, Math.min(have, parseInt(e.target.value, 10) || 0)) }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </Field>

              {/* 饮品师果汁分配（按使用瓶数逐瓶选目标）；普通玩家果汁仅对自己 */}
              {me.roleId === "bartender" ? (
                <RoleSkillField room={room} me={me} value={roleSkill} onChange={setRoleSkill} counts={counts} juiceUseCount={useCounts["juice"] ?? 0} />
              ) : (useCounts["juice"] ?? 0) > 0 && (
                <Field label={`果汁目标（本轮使用 ${useCounts["juice"]} 瓶）`}>
                  <select className="select" disabled value="self">
                    <option value="self">对自己使用（普通玩家的果汁仅能对自己使用）</option>
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">结算阶段对自己逐瓶掷骰生效。</p>
                </Field>
              )}

              {hasRocket && (
                <Field label="火箭筒袭击目标房间（可选，本轮结算生效）">
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

              {showWaterFoodPrepay && (
                <Field label={`是否为下一轮（${nextRoundLabel}）交水粮？（预交 1 水 + 1 粮食，缺则${nextRoundLabel}结算扣血）`}>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={submitWater} onChange={(e) => setSubmitWater(e.target.checked)} disabled={!counts["water"]} />
                      交水（持有 {counts["water"] ?? 0}）
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={submitFood} onChange={(e) => setSubmitFood(e.target.checked)} disabled={!counts["food"]} />
                      交粮食（持有 {counts["food"] ?? 0}）
                    </label>
                  </div>
                </Field>
              )}

              {/* 步骤 11：毒气投票 */}
              <Field label="毒气投票楼层（必投）">
                <select className="select" value={gasVoteFloor} onChange={(e) => setGasVoteFloor(e.target.value)}>
                  <option value="">请选择</option>
                  {FLOORS.map((f) => (
                    <option key={f.id} value={f.id} disabled={room.gasFloors.includes(f.id)}>
                      {f.label}{room.gasFloors.includes(f.id) ? "（已是毒气楼层）" : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Button
                variant="ghost"
                className="w-full"
                disabled={juiceTargetsIncomplete}
                onClick={() => run((r) => reviseAction(r, me.id, revisePatch()))}
              >
                保存本轮道具 / 水粮 / 毒气投票
              </Button>
            </>
          )}

          {over && <DiscardPanel me={me} run={run} />}

          {/* 步骤 12：黄色结束行动按钮（必要流程完成后才可点） */}
          <Button
            variant="gold"
            className="w-full"
            disabled={over || gasMissing || juiceTargetsIncomplete || mustHandleDraw}
            onClick={() => run((r) => endTurn(isShadow ? r : reviseAction(r, me.id, revisePatch()), me.id))}
          >
            结束本轮行动（结束后不可更改，轮到下一顺位）
          </Button>
          {over && <p className="text-[11px] text-red-300">超重时无法结束行动，请先丢弃至不超过负重。</p>}
          {mustHandleDraw && <p className="text-[11px] text-amber-300">请先处理抽卡（抽卡或放弃）再结束行动。</p>}
          {!mustHandleDraw && gasMissing && <p className="text-[11px] text-amber-300">请先完成毒气投票再结束行动。</p>}
        </>
      )}
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

  // §6：房间被黑客关闭时本轮不能抽卡 / 不产生收益，进入者可私密获知。
  const closed = !isRoomFunctionAvailable(target, room);
  const canDraw = !closed && isDrawRoom(target) && target !== "B503";
  const isTrash = !closed && target === "B503";
  const canGold = !closed && me.inventory.includes("gold") && isDrawRoom(target) && target !== "B206" && target !== "B503";
  const isHelipad = !closed && target === "202";
  const availableAirdrops = room.airdrops.filter((a) => !a.claimed);
  // §3：每次行动只能常规抽卡一次；抽完即时私密展示抽到内容。
  const drawn = !!me.submittedAction?.hasDrawnFromRoom;
  const skipped = !!me.submittedAction?.drawSkipped;
  const drawResult = me.submittedAction?.privateDrawResult ?? [];
  // §3 强制抽卡确认：可抽卡房间且有库存时，必须抽卡或放弃，才能结束行动（关闭房间不强制）。
  const mustHandleDraw = (canDraw || isTrash) && !drawn && !skipped && invTotal > 0;

  if (!fn) return null;

  return (
    <div className="border-t border-ink-600 pt-3 space-y-3">
      <p className="text-xs text-slate-400">目标房间功能：{fn.name} —— {fn.effect}</p>
      {closed ? (
        <p className="text-xs text-amber-300">该房间功能本轮被黑客关闭：无法抽卡、不触发任何房间收益（仅你可见）。</p>
      ) : (
        <p className="text-xs text-slate-500">房间当前库存：{invTotal} 张</p>
      )}

      {(canDraw || isTrash) && drawn && (
        <div className="bg-emerald-900/20 border border-emerald-700 rounded p-2 text-sm">
          <span className="text-emerald-300">本次抽到（私密）：</span>
          {drawResult.length ? drawResult.map(getItemName).join("、") : "无"}
          <p className="text-[11px] text-slate-500 mt-1">每次行动只能抽一次，已抽过。</p>
        </div>
      )}
      {canDraw && <Button disabled={drawn} onClick={() => run((r) => drawItemsFromRoom(r, target, me.id, limit))}>抽卡（最多 {limit} 张，每次行动一次）</Button>}
      {isTrash && <Button disabled={drawn} onClick={() => run((r) => drawFromTrash(r, me.id, 5))}>垃圾场抽卡（最多 5 张，非垃圾最多保留 2 张）</Button>}

      {mustHandleDraw && (
        <div className="bg-amber-900/20 border border-amber-700 rounded p-2">
          <p className="text-[11px] text-amber-300 mb-1">本房间可抽卡：请先抽卡，或选择放弃，否则无法结束本轮行动。</p>
          <Button variant="ghost" className="px-2 py-1 min-h-0" onClick={() => run((r) => skipDraw(r, me.id))}>放弃抽卡</Button>
        </div>
      )}
      {skipped && !drawn && <p className="text-[11px] text-slate-500">已放弃本房间抽卡。</p>}

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
                  领取{formatRoundLabel(a.round)}空投（{Object.entries(a.items).map(([id, n]) => `${getItemName(id)}×${n}`).join("、")}）
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

/**
 * 慈善家赠予后，被赠予玩家自行选择转出哪一项基因（v1.0.3 §1）。
 * 只能选择当前 >0 的基因；速度不能降到 0（速度永远 ≥1）。
 */
function GiftGeneChoiceCard({ room, me, run }: { room: GameRoom; me: Player; run: (fn: (r: GameRoom) => GameRoom) => void }) {
  const charity = room.players.find((p) => p.id === me.pendingGiftFrom);
  const genes: Array<{ key: "force" | "speed" | "load"; label: string; value: number }> = [
    { key: "force", label: "武力", value: me.force },
    { key: "speed", label: "速度", value: me.speed },
    { key: "load", label: "负重", value: me.load },
  ];
  return (
    <Card title="慈善家赠予：请选择转移 1 点基因" className="mb-4 border-gold/50">
      <p className="text-sm text-slate-300 mb-1">
        你被慈善家{charity ? `（${roleWithNick(charity)}）` : ""}赠予了 1 张道具，须公开将 1 点基因永久转移给对方。
      </p>
      <p className="text-[11px] text-slate-500 mb-2">由你自行选择转出哪一项；不能选择数值为 0 的基因，速度不能降到 0。</p>
      <div className="flex flex-wrap gap-2">
        {genes.map((g) => {
          const disabled = g.value <= 0 || (g.key === "speed" && g.value <= 1);
          return (
            <Button key={g.key} variant="gold" disabled={disabled} onClick={() => run((r) => chooseGiftGene(r, me.id, g.key))}>
              转出{g.label}（当前 {g.value}）{g.key === "speed" && g.value <= 1 ? "·不可" : ""}
            </Button>
          );
        })}
      </div>
    </Card>
  );
}

function RoleStatusCard({ me }: { me: Player }) {
  const role = getRole(me.roleId);
  if (!role) return null;
  const max = roleMaxUses(me.roleId);
  return (
    <Card title={`职业 · ${role.name}`} className="mb-4">
      <p className="text-[11px] text-slate-400 leading-snug mb-2">{role.skill}</p>
      <div className="flex flex-wrap gap-2 text-xs">
        {max !== Infinity && <Badge tone="gold">剩余次数 {Math.max(0, max - (me.roleUses ?? 0))}/{max}</Badge>}
        {(me.infection ?? 0) > 0 && <Badge tone="blood">感染标记 ×{me.infection}</Badge>}
        {(me.pendingGenePoints ?? 0) > 0 && <Badge tone="toxic">待分配基因 {me.pendingGenePoints}（请房主在控制台分配）</Badge>}
        {role.automation !== "full" && <Badge>{role.automation === "todo" ? "需房主辅助" : "部分自动"}</Badge>}
      </div>
      {role.note && <p className="text-[11px] text-slate-500 mt-2">说明：{role.note}</p>}
    </Card>
  );
}

function TradePanel({ room, me, run }: { room: GameRoom; me: Player; run: (fn: (r: GameRoom) => GameRoom) => void }) {
  const others = room.players.filter((p) => p.name && p.id !== me.id);
  const { incoming, outgoing } = pendingTradesFor(room, me.id);
  const counts: Record<string, number> = {};
  for (const id of me.inventory) counts[id] = (counts[id] ?? 0) + 1;

  const [toPlayerId, setToPlayerId] = useState("");
  const [offerItem, setOfferItem] = useState("");
  const [offerOrder, setOfferOrder] = useState(false);
  const [note, setNote] = useState("");

  const nameOf = (id: string) => {
    const p = room.players.find((x) => x.id === id);
    return p ? roleWithNick(p) : "玩家";
  };

  const doCreate = () => {
    run((r) =>
      createTrade(r, me.id, {
        toPlayerId,
        offerItems: offerItem ? [offerItem] : [],
        offerOrderCard: offerOrder,
        note,
      })
    );
    setOfferItem(""); setOfferOrder(false); setNote("");
  };

  return (
    <Card title="自由阶段交易" className="mb-4">
      {incoming.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="text-xs text-amber-300">收到的交易请求：</div>
          {incoming.map((t) => (
            <div key={t.id} className="bg-ink-700 border border-ink-600 rounded p-2 text-sm">
              <div>{nameOf(t.fromPlayerId)} 给你：{[...t.offerItems.map(getItemName), ...(t.offerOrderCard ? ["顺位卡"] : [])].join("、") || "（无）"}</div>
              {(t.requestItems.length > 0 || t.requestOrderCard) && (
                <div className="text-slate-400">索取你：{[...t.requestItems.map(getItemName), ...(t.requestOrderCard ? ["顺位卡"] : [])].join("、")}</div>
              )}
              {t.note && <div className="text-slate-500 text-xs">备注：{t.note}</div>}
              <div className="flex gap-2 mt-2">
                <Button variant="primary" onClick={() => run((r) => respondTrade(r, t.id, true))}>接受</Button>
                <Button variant="ghost" onClick={() => run((r) => respondTrade(r, t.id, false))}>拒绝</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="mb-3 space-y-1">
          <div className="text-xs text-slate-400">我发起的待处理交易：</div>
          {outgoing.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-sm bg-ink-700 border border-ink-600 rounded px-2 py-1">
              <span>给 {nameOf(t.toPlayerId)}：{[...t.offerItems.map(getItemName), ...(t.offerOrderCard ? ["顺位卡"] : [])].join("、")}</span>
              <Button variant="ghost" onClick={() => run((r) => cancelTrade(r, t.id))}>撤销</Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select className="select" value={toPlayerId} onChange={(e) => setToPlayerId(e.target.value)}>
          <option value="">选择交易对象…</option>
          {others.map((p) => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
        </select>
        <select className="select" value={offerItem} onChange={(e) => setOfferItem(e.target.value)}>
          <option value="">给出道具（可选）…</option>
          {Object.entries(counts).map(([id, n]) => <option key={id} value={id}>{getItemName(id)} ×{n}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm mt-2">
        <input type="checkbox" checked={offerOrder} disabled={me.orderCard == null} onChange={(e) => setOfferOrder(e.target.checked)} />
        给出我的顺位卡（{me.orderCard ?? "无"}）
      </label>
      <input className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1 mt-2 text-sm" placeholder="备注（可选）" value={note} maxLength={40} onChange={(e) => setNote(e.target.value)} />
      <Button variant="gold" className="w-full mt-2" disabled={!toPlayerId || (!offerItem && !offerOrder)} onClick={doCreate}>
        发起交易
      </Button>
      <p className="text-[11px] text-slate-500 mt-2">仅可交易道具卡与顺位卡；不可交易生命/基因/位置。对方接受后自动转移。</p>
    </Card>
  );
}

/** 行动阶段主动职业技能输入（化学家/催眠师/预言家/慈善家）。 */
function RoleSkillField({
  room, me, value, onChange, counts, juiceUseCount,
}: {
  room: GameRoom; me: Player; value: RoleSkillInput | undefined;
  onChange: (v: RoleSkillInput | undefined) => void; counts: Record<string, number>;
  juiceUseCount: number;
}) {
  const role = getRole(me.roleId);
  if (!role?.active) return null;
  const others = room.players.filter((p) => p.name && p.id !== me.id && p.status === "alive");
  const max = roleMaxUses(me.roleId);
  const left = max === Infinity ? Infinity : Math.max(0, max - (me.roleUses ?? 0));

  if (left === 0) {
    return <Field label={`职业技能（${role.name}）`}><p className="text-xs text-slate-500">技能次数已用尽。</p></Field>;
  }

  // 化学家
  if (me.roleId === "chemist") {
    const gassedRooms = ROOMS.filter((r) => room.gasFloors.includes(getRoomFloor(r.id))).map((r) => r.id);
    return (
      <Field label="化学家技能（本轮，可选）">
        <select className="select" value={value?.type ?? ""} onChange={(e) => {
          const t = e.target.value;
          onChange(t ? { type: t, targetRoom: t === "chemist_minus" ? gassedRooms[0] : undefined } : undefined);
        }}>
          <option value="">不使用</option>
          <option value="chemist_plus">①本轮毒气楼层伤害 +2</option>
          <option value="chemist_minus">②指定毒气房间本轮 -2</option>
        </select>
        {value?.type === "chemist_minus" && (
          <select className="select mt-2" value={value.targetRoom ?? ""} onChange={(e) => onChange({ type: "chemist_minus", targetRoom: e.target.value })}>
            <option value="">选择已满毒气的房间…</option>
            {gassedRooms.map((id) => <option key={id} value={id}>{getRoomLabel(id)}</option>)}
          </select>
        )}
      </Field>
    );
  }

  // 催眠师
  if (me.roleId === "hypnotist") {
    const target = room.players.find((p) => p.id === value?.targetPlayerIds?.[0]);
    const dist = target?.location && value?.targetRoom ? normalStepDistance(target.location, value.targetRoom) : null;
    return (
      <Field label={`催眠师技能（剩 ${left} 次，可选）`}>
        <p className="text-[11px] text-slate-500 mb-1">催眠目标本人在轮到其行动前不会知道；目标按 5 步内（无视其速度、不可用捷径）判定可达。</p>
        <select className="select" value={value?.targetPlayerIds?.[0] ?? ""} onChange={(e) => onChange(e.target.value ? { type: "charm", targetPlayerIds: [e.target.value], targetRoom: value?.targetRoom } : undefined)}>
          <option value="">不催眠</option>
          {[me, ...others].filter((p) => !p.charmedDone).map((p) => <option key={p.id} value={p.id}>{playerLabel(p)}{p.id === me.id ? "（自己）" : ""}</option>)}
        </select>
        {value?.type === "charm" && (
          <>
            <select className="select mt-2" value={value.targetRoom ?? ""} onChange={(e) => onChange({ ...value, targetRoom: e.target.value })}>
              <option value="">强制前往房间…</option>
              {ROOMS.map((r) => <option key={r.id} value={r.id}>{getRoomLabel(r.id)}</option>)}
            </select>
            {value.targetRoom && <p className="text-[11px] text-slate-500 mt-1">目标普通步数：{dist ?? "不可达"}（需 ≤5）</p>}
          </>
        )}
      </Field>
    );
  }

  // 预言家
  if (me.roleId === "prophet") {
    const picked = value?.targetPlayerIds ?? [];
    const toggle = (id: string) => {
      const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
      onChange(next.length ? { type: "forecast", targetPlayerIds: next } : undefined);
    };
    return (
      <Field label={`预言家·死亡预告（剩 ${left} 次，可选）`}>
        <div className="flex flex-wrap gap-1">
          {others.map((p) => (
            <button key={p.id} type="button" onClick={() => toggle(p.id)}
              className={cls("text-xs px-2 py-1 rounded border", picked.includes(p.id) ? "bg-gold/30 border-gold text-gold" : "bg-ink-700 border-ink-600")}>
              {playerLabel(p)}
            </button>
          ))}
        </div>
      </Field>
    );
  }

  // 慈善家
  if (me.roleId === "philanthropist") {
    return (
      <Field label="慈善家·赠予（结算阶段，可选）">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select className="select" value={value?.targetPlayerIds?.[0] ?? ""} onChange={(e) => onChange(e.target.value ? { type: "gift", targetPlayerIds: [e.target.value], giveItemId: value?.giveItemId } : undefined)}>
            <option value="">选择赠予对象…</option>
            {others.filter((p) => !p.giftedDone).map((p) => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
          </select>
          <select className="select" value={value?.giveItemId ?? ""} onChange={(e) => onChange({ type: "gift", targetPlayerIds: value?.targetPlayerIds ?? [], giveItemId: e.target.value })}>
            <option value="">赠出道具…</option>
            {Object.entries(counts).map(([id, n]) => <option key={id} value={id}>{getItemName(id)} ×{n}</option>)}
          </select>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">对方将公开转移其最高的 1 点非 0 基因给你。</p>
      </Field>
    );
  }

  // 饮品师·果汁（§5）：按本轮使用的果汁瓶数生成多个目标分配条，每瓶可独立选目标与 3 骰面。
  if (me.roleId === "bartender") {
    const faceLabel = ["", "弃光道具", "无事", "武力+1", "速度+1", "负重+1", "生命+2"];
    if (juiceUseCount <= 0) {
      return (
        <Field label="饮品师·果汁">
          <p className="text-[11px] text-slate-500">先在上方「本轮使用道具」勾选要使用的果汁数量，这里会按瓶数生成目标分配条。</p>
        </Field>
      );
    }
    const assigns = value?.type === "juice" ? value.juiceAssignments ?? [] : [];
    const bars = Array.from({ length: juiceUseCount }, (_, i) => assigns[i] ?? { targetPlayerId: me.id, diceFaces: [] as number[] });
    const update = (i: number, patch: Partial<{ targetPlayerId: string; diceFaces: number[] }>) => {
      const next = bars.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
      onChange({ type: "juice", juiceAssignments: next });
    };
    const toggleFace = (i: number, f: number) => {
      const cur = bars[i].diceFaces ?? [];
      const nf = cur.includes(f) ? cur.filter((x) => x !== f) : cur.length >= 3 ? cur : [...cur, f];
      update(i, { diceFaces: nf });
    };
    return (
      <Field label={`饮品师·果汁（本轮使用 ${juiceUseCount} 瓶，逐瓶分配目标）`}>
        <div className="space-y-3">
          {bars.map((b, i) => (
            <div key={i} className="border border-ink-600 rounded p-2">
              <div className="text-[11px] text-slate-400 mb-1">第 {i + 1} 瓶 · 目标</div>
              <select className="select" value={b.targetPlayerId} onChange={(e) => update(i, { targetPlayerId: e.target.value })}>
                <option value={me.id}>对自己</option>
                {others.map((p) => <option key={p.id} value={p.id}>对 {playerLabel(p)}</option>)}
              </select>
              <div className="text-[11px] text-slate-400 mt-2 mb-1">可选 3 个骰面（结算随机取其一；不选则 1-6 随机）</div>
              <div className="flex flex-wrap gap-1">
                {[1, 2, 3, 4, 5, 6].map((f) => (
                  <button key={f} type="button"
                    disabled={!(b.diceFaces ?? []).includes(f) && (b.diceFaces ?? []).length >= 3}
                    onClick={() => toggleFace(i, f)}
                    className={cls("text-[11px] px-2 py-1 rounded border", (b.diceFaces ?? []).includes(f) ? "bg-gold/30 border-gold text-gold" : "bg-ink-700 border-ink-600 disabled:opacity-40")}>
                    {f}·{faceLabel[f]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">瓶数随上方「使用果汁」数量变化；目标可重复或分配给不同玩家。结算阶段统一生效，行动阶段不公开。</p>
      </Field>
    );
  }

  // 私家侦探（§11）：只能跟踪本轮顺位在自己之前、且已结束行动的存活玩家；不显示其去向房间。
  if (me.roleId === "detective") {
    const trackable = others.filter(
      (p) =>
        p.orderCard != null &&
        me.orderCard != null &&
        p.orderCard < me.orderCard &&
        p.endedAction &&
        !p.trackedDone
    );
    return (
      <Field label={`私家侦探·跟踪（剩 ${left} 次，可选）`}>
        {me.forcedRoom ? <p className="text-[11px] text-purple-300">被催眠时无法跟踪。</p> : (
          <>
            <select className="select" value={value?.targetPlayerIds?.[0] ?? ""} onChange={(e) => onChange(e.target.value ? { type: "track", targetPlayerIds: [e.target.value] } : undefined)}>
              <option value="">不跟踪</option>
              {trackable.map((p) => <option key={p.id} value={p.id}>{playerLabel(p)}（已行动）</option>)}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              只能跟踪顺位在你之前且已行动的玩家；看不到目标去向。选择后放弃自己的移动，直接前往其终点房间（无需再选目标房间）。
            </p>
          </>
        )}
      </Field>
    );
  }

  // 黑客
  if (me.roleId === "hacker") {
    const used = me.roleActionsUsed ?? [];
    return <HackerSkillField room={room} me={me} value={value} onChange={onChange} used={used} />;
  }

  // 驯兽师·巡回猎犬
  if (me.roleId === "beastmaster") {
    const from = me.location ?? "";
    const houndRooms = ROOMS.filter((r) => {
      if (r.id === from) return false;
      const hasStock = r.id === "202"
        ? room.airdrops.some((a) => !a.claimed && Object.keys(a.items).length > 0)
        : Object.values(room.roomInventories[r.id] ?? {}).some((n) => n > 0);
      if (!hasStock) return false;
      const d = normalStepDistance(from, r.id);
      return d !== null && d <= 5;
    });
    return (
      <Field label={`驯兽师·巡回猎犬（剩 ${left} 次，可选）`}>
        <select className="select" value={value?.targetRoom ?? ""} onChange={(e) => onChange(e.target.value ? { type: "hound", targetRoom: e.target.value } : undefined)}>
          <option value="">不派遣</option>
          {houndRooms.map((r) => <option key={r.id} value={r.id}>{getRoomLabel(r.id)}</option>)}
        </select>
        <p className="text-[11px] text-slate-500 mt-1">从当前位置起 5 步内（不经捷径）有库存的房间随机抽 1 张；超重则无功而返。提交即结算。</p>
      </Field>
    );
  }

  return (
    <Field label={`职业技能（${role.name}）`}>
      <p className="text-[11px] text-slate-500">{role.actionHint}。</p>
    </Field>
  );
}

function HackerSkillField({
  room, me, value, onChange, used,
}: {
  room: GameRoom; me: Player; value: RoleSkillInput | undefined;
  onChange: (v: RoleSkillInput | undefined) => void; used: string[];
}) {
  const total = me.force + me.speed + me.load;
  const [gf, setGf] = useState(me.force);
  const [gs, setGs] = useState(me.speed);
  const [gl, setGl] = useState(me.load);

  const kind = value?.type === "hacker_close" ? "close"
    : value?.type === "hacker_func" ? (value.funcChoice ?? "") : "";

  const setKind = (k: string) => {
    if (k === "") return onChange(undefined);
    if (k === "close") return onChange({ type: "hacker_close", targetRoom: "" });
    if (k === "control") return onChange({ type: "hacker_func", funcChoice: "control" });
    if (k === "operate") return onChange({ type: "hacker_func", funcChoice: "operate", genes: { force: gf, speed: gs, load: gl } });
    return onChange({ type: "hacker_func", funcChoice: k });
  };

  return (
    <Field label="黑客技能（每种行动整局 1 次，可选）">
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="">不使用</option>
        <option value="close" disabled={used.includes("close")}>关闭 1 个房间功能{used.includes("close") ? "（已用）" : ""}</option>
        <option value="gene" disabled={used.includes("gene")}>基因库：三项 +1{used.includes("gene") ? "（已用）" : ""}</option>
        <option value="control" disabled={used.includes("control")}>控制室{used.includes("control") ? "（已用）" : ""}</option>
        <option value="operate" disabled={used.includes("operate")}>操作室：重分配基因{used.includes("operate") ? "（已用）" : ""}</option>
      </select>

      {kind === "close" && (
        <select className="select mt-2" value={value?.targetRoom ?? ""} onChange={(e) => onChange({ type: "hacker_close", targetRoom: e.target.value })}>
          <option value="">选择要关闭的房间…</option>
          {ROOMS.map((r) => <option key={r.id} value={r.id}>{getRoomLabel(r.id)}</option>)}
        </select>
      )}

      {kind === "control" && (
        <select className="select mt-2" value={value?.targetRoom ?? ""} onChange={(e) => onChange({ type: "hacker_func", funcChoice: "control", targetRoom: e.target.value || undefined })}>
          <option value="">①本轮毒气投票 1 票视为 10 票</option>
          {ROOMS.map((r) => <option key={r.id} value={r.id}>②解除 {getRoomLabel(r.id)} 的毒气</option>)}
        </select>
      )}

      {kind === "operate" && (
        <div className="mt-2">
          <div className="flex items-center gap-1 text-xs">
            武<input type="number" className="w-12 bg-ink-700 border border-ink-600 rounded px-1" value={gf} onChange={(e) => { const v = Math.max(0, +e.target.value); setGf(v); onChange({ type: "hacker_func", funcChoice: "operate", genes: { force: v, speed: gs, load: gl } }); }} />
            速<input type="number" className="w-12 bg-ink-700 border border-ink-600 rounded px-1" value={gs} onChange={(e) => { const v = Math.max(0, +e.target.value); setGs(v); onChange({ type: "hacker_func", funcChoice: "operate", genes: { force: gf, speed: v, load: gl } }); }} />
            负<input type="number" className="w-12 bg-ink-700 border border-ink-600 rounded px-1" value={gl} onChange={(e) => { const v = Math.max(0, +e.target.value); setGl(v); onChange({ type: "hacker_func", funcChoice: "operate", genes: { force: gf, speed: gs, load: v } }); }} />
          </div>
          <p className={cls("text-[11px] mt-1", gf + gs + gl === total ? "text-slate-500" : "text-red-400")}>三项之和需等于当前总和 {total}（当前 {gf + gs + gl}）</p>
        </div>
      )}
    </Field>
  );
}

/** 本轮顺位列表（§12）：按顺位卡升序，显示顺位/编号/昵称/角色名/是否已行动/当前行动玩家。 */
function TurnOrderCard({ room, myId }: { room: GameRoom; myId?: string }) {
  const seated = room.players.filter((p) => p.name);
  const turnId = currentTurnPlayerId(room);
  // 有顺位卡的存活玩家按顺位升序；暗影（无顺位卡）排在最后。
  const ordered = [...seated].sort((a, b) => {
    const oa = a.orderCard ?? 999;
    const ob = b.orderCard ?? 999;
    return oa - ob || a.seatIndex - b.seatIndex;
  });
  const isAction = room.currentPhase === "ACTION";
  return (
    <Card title={`本轮顺位（${formatRoundLabel(room.currentRound)}）`} className="mb-4">
      <div className="space-y-1 text-sm">
        {ordered.map((p) => {
          const isCurrent = isAction && p.id === turnId;
          return (
            <div
              key={p.id}
              className={cls(
                "flex items-center justify-between rounded px-2 py-1",
                isCurrent ? "bg-gold/20 border border-gold" : "bg-ink-700"
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-10">
                  {p.status === "shadow" ? "暗影" : p.orderCard != null ? `顺位${p.orderCard}` : "—"}
                </span>
                <span className={cls(p.id === myId && "text-gold")}>{playerLabel(p)}</span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                {p.status === "shadow" && <Badge tone="shadow">暗影</Badge>}
                {isAction && (p.endedAction ? <Badge tone="toxic">已行动</Badge> : isCurrent ? <Badge tone="gold">行动中</Badge> : <Badge>待行动</Badge>)}
              </span>
            </div>
          );
        })}
      </div>
      {isAction && (
        <p className="text-[11px] text-slate-500 mt-2">
          {turnId ? `当前应由 ${playerLabel(seated.find((p) => p.id === turnId)!)} 行动。` : "存活玩家均已结束行动，等待房主进入结算。"}
        </p>
      )}
    </Card>
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
