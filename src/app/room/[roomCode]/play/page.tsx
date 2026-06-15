"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useEnsureHydrated } from "@/components/store-hooks";
import { Button, Card, Badge, cls } from "@/components/ui";
import type { GameRoom, Player } from "@/game/types";
import { submitAction } from "@/game/engine";
import { getRole } from "@/game/config/roles";
import { getItemName } from "@/game/config/items";
import { roomsByFloor, getRoomLabel } from "@/game/config/rooms";
import { getRoomFunction } from "@/game/config/roomFunctions";
import { FLOORS } from "@/game/config/floors";
import { PHASE_INFO } from "@/game/config/phases";

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

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">我的面板 · <span className="text-gold">{code}</span></h1>
        <div className="flex gap-2">
          <Link href={`/room/${code}/board`}><Button variant="ghost">公共战况</Button></Link>
        </div>
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

      {!me ? (
        <Card>请选择一个身份以查看私密面板。</Card>
      ) : (
        <PrivatePanel
          room={room}
          me={me}
          onSubmit={(input) => {
            setError("");
            try {
              apply(code, (r) => submitAction(r, me.id, input));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </main>
  );
}

function PrivatePanel({
  room,
  me,
  onSubmit,
}: {
  room: GameRoom;
  me: Player;
  onSubmit: (input: { toRoom: string; gasVoteFloor?: string | null; roomAction?: string; notes?: string }) => void;
}) {
  const isShadow = me.status === "shadow";
  const phase = PHASE_INFO[room.currentPhase];

  return (
    <>
      <Card title="本轮状态" className="mb-4">
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <Stat label="轮次" value={`第 ${room.currentRound} 轮`} />
          <Stat label="阶段" value={phase?.label ?? room.currentPhase} />
          <Stat label="职业" value={getRole(me.roleId)?.name ?? "—"} />
          <Stat label="状态" value={isShadow ? "暗影" : "存活"} tone={isShadow ? "shadow" : "toxic"} />
          <Stat label="生命值" value={`${me.hp} / ${me.maxHp}`} tone="blood" />
          <Stat label="顺位卡" value={me.orderCard ?? "—"} />
          <Stat label="武力 / 速度 / 负重" value={`${me.force} / ${me.speed} / ${me.load}`} />
          <Stat label="当前位置" value={me.location ? getRoomLabel(me.location) : "—"} />
        </div>
        <div className="mt-3">
          <span className="text-xs text-slate-400">我的道具：</span>
          {me.inventory.length === 0 ? (
            <span className="text-xs text-slate-500">无</span>
          ) : (
            <span className="text-xs">{me.inventory.map(getItemName).join("、")}</span>
          )}
        </div>
      </Card>

      <Card title="本轮提交">
        <p className="text-xs text-slate-400 mb-3">{phase?.description}</p>
        {room.currentPhase !== "ACTION" ? (
          <p className="text-slate-400 text-sm">非行动阶段，暂不可提交行动。</p>
        ) : me.submittedAction ? (
          <SubmittedView me={me} />
        ) : (
          <ActionForm me={me} isShadow={isShadow} gasFloors={room.gasFloors} onSubmit={onSubmit} />
        )}
      </Card>
    </>
  );
}

function ActionForm({
  me,
  isShadow,
  gasFloors,
  onSubmit,
}: {
  me: Player;
  isShadow: boolean;
  gasFloors: string[];
  onSubmit: (input: { toRoom: string; gasVoteFloor?: string | null; roomAction?: string; notes?: string }) => void;
}) {
  const [toRoom, setToRoom] = useState("");
  const [gasVoteFloor, setGasVoteFloor] = useState("");
  const [roomAction, setRoomAction] = useState("");
  const [notes, setNotes] = useState("");

  const destFn = toRoom ? getRoomFunction(toRoom) : undefined;

  return (
    <div className="space-y-3">
      <Field label="目标房间（存活玩家必须移动，不能与当前房间相同）">
        <select className="select" value={toRoom} onChange={(e) => { setToRoom(e.target.value); setRoomAction(""); }}>
          <option value="">请选择</option>
          {roomsByFloor().map(({ floor, rooms }) => (
            <optgroup key={floor} label={floor}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id} disabled={!isShadow && r.id === me.location}>
                  {getRoomLabel(r.id)}{!isShadow && r.id === me.location ? "（当前）" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>

      {!isShadow && destFn && (
        <Field label={`房间功能（${destFn.name}）`}>
          <select className="select" value={roomAction} onChange={(e) => setRoomAction(e.target.value)}>
            <option value="">不使用</option>
            <option value={destFn.name}>使用：{destFn.name}</option>
          </select>
          <p className="text-[11px] text-slate-500 mt-1">{destFn.effect}</p>
        </Field>
      )}

      {isShadow ? (
        <p className="text-sm text-purple-300">暗影玩家不参与毒气投票、不使用房间功能、不抽道具，仅提交移动终点。</p>
      ) : (
        <Field label="毒气投票楼层">
          <select className="select" value={gasVoteFloor} onChange={(e) => setGasVoteFloor(e.target.value)}>
            <option value="">请选择</option>
            {FLOORS.map((f) => (
              <option key={f.id} value={f.id} disabled={gasFloors.includes(f.id)}>
                {f.label}{gasFloors.includes(f.id) ? "（已是毒气楼层）" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="备注（可选）">
        <input className="select" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="如使用的道具、职业技能等" />
      </Field>

      <Button
        variant="primary"
        className="w-full"
        onClick={() =>
          onSubmit({
            toRoom,
            gasVoteFloor: isShadow ? null : gasVoteFloor,
            roomAction: roomAction || undefined,
            notes: notes || undefined,
          })
        }
      >
        提交本轮行动
      </Button>
    </div>
  );
}

function SubmittedView({ me }: { me: Player }) {
  const a = me.submittedAction!;
  return (
    <div className="space-y-2 text-sm">
      <Badge tone="toxic">已提交</Badge>
      <p>目标房间：{getRoomLabel(a.toRoom)}</p>
      {a.roomAction && <p>房间功能：{a.roomAction}</p>}
      {a.gasVoteFloor ? <p>毒气投票：{a.gasVoteFloor}</p> : <p className="text-purple-300">未投毒气（暗影）</p>}
      {a.notes && <p className="text-slate-400">备注：{a.notes}</p>}
      <p className="text-xs text-slate-500">如需修改，请房主在公共战况页重置你的提交。</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "blood" | "toxic" | "shadow" }) {
  const color = tone === "blood" ? "text-red-300" : tone === "toxic" ? "text-toxic" : tone === "shadow" ? "text-purple-300" : "text-slate-100";
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cls("font-medium", color)}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="max-w-md mx-auto px-4 py-10 text-center text-slate-400">{children}</main>;
}
