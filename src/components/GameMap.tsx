"use client";

import { useState } from "react";
import { FLOORS } from "@/game/config/floors";
import { ROOMS, getRoomLabel } from "@/game/config/rooms";
import { isRoomGassed } from "@/game/gas";
import { cls } from "./ui";

// 地图图片放在 public/ 下，文件名含中文需 encodeURI。来源：禁闭逃杀_地图.png
const MAP_SRC = encodeURI("/禁闭逃杀_地图.png");

export interface GameMapProps {
  selectedRoomId?: string;
  currentPlayerRoomId?: string;
  /** 本轮可达房间，列表中高亮可点 */
  reachableRoomIds?: string[];
  /** 点击房间标签回调（仅可达房间可点） */
  onPickRoom?: (roomId: string) => void;
  gasFloors?: string[];
  clearedGasRooms?: string[];
  showLegend?: boolean;
  compact?: boolean;
}

/**
 * v0.2 地图组件：仅做显示与对照，不做热区点击 / 路径算法。
 * 显示原始地图图片 + 按楼层分组的房间列表，标识选中目标、当前位置、毒气楼层。
 */
export function GameMap({
  selectedRoomId,
  currentPlayerRoomId,
  reachableRoomIds,
  onPickRoom,
  gasFloors = [],
  clearedGasRooms = [],
  showLegend = true,
  compact = false,
}: GameMapProps) {
  const [imgOk, setImgOk] = useState(true);
  const reachable = new Set(reachableRoomIds ?? []);

  return (
    <div className="space-y-3">
      <div className="rounded-lg overflow-hidden border border-ink-600 bg-ink-900">
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={MAP_SRC}
            alt="禁闭逃杀地图"
            className="w-full h-auto block"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="p-6 text-center text-slate-400 text-sm">地图图片未找到</div>
        )}
      </div>

      {showLegend && (
        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
          <Legend className="bg-gold/30 border-gold" label="目标房间" />
          <Legend className="bg-blue-500/30 border-blue-400" label="当前位置" />
          {reachableRoomIds && <Legend className="bg-emerald-500/20 border-emerald-400" label="可到达" />}
          <Legend className="bg-toxic/20 border-toxic" label="毒气楼层" />
        </div>
      )}

      <div className={cls("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
        {FLOORS.map((floor) => {
          const floorGassed = gasFloors.includes(floor.id);
          const rooms = ROOMS.filter((r) => r.floor === floor.id);
          return (
            <div key={floor.id} className="bg-ink-800 border border-ink-600 rounded p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-200">{floor.label}</span>
                {floorGassed && (
                  <span className="text-[10px] px-1 rounded bg-toxic/20 text-toxic border border-toxic/40">
                    毒气
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {rooms.map((r) => {
                  const gassed = isRoomGassed(r.id, gasFloors, clearedGasRooms);
                  const selected = r.id === selectedRoomId;
                  const current = r.id === currentPlayerRoomId;
                  const canReach = reachable.has(r.id);
                  const clickable = canReach && !!onPickRoom;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={!clickable}
                      onClick={clickable ? () => onPickRoom!(r.id) : undefined}
                      title={getRoomLabel(r.id)}
                      className={cls(
                        "text-[11px] px-1.5 py-0.5 rounded border",
                        clickable && "cursor-pointer hover:brightness-125",
                        selected && "bg-gold/30 border-gold text-gold",
                        !selected && current && "bg-blue-500/30 border-blue-400 text-blue-200",
                        !selected && !current && canReach && "bg-emerald-500/20 border-emerald-400 text-emerald-200",
                        !selected && !current && !canReach && gassed && "bg-toxic/15 border-toxic/40 text-toxic",
                        !selected && !current && !canReach && !gassed && "bg-ink-700 border-ink-600 text-slate-300"
                      )}
                    >
                      {r.name ? `${r.id}·${r.name}` : r.id}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cls("inline-block w-3 h-3 rounded border", className)} />
      {label}
    </span>
  );
}
