"use client";

import { useEffect } from "react";
import { useGameStore } from "@/store/useGameStore";

/** 确保客户端载入存储一次，返回是否已 hydrate。 */
export function useEnsureHydrated(): boolean {
  const hydrated = useGameStore((s) => s.hydrated);
  const hydrate = useGameStore((s) => s.hydrate);
  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);
  return hydrated;
}

/** 进入某房间页时开始同步（远程轮询 / 本地载入），离开时停止。 */
export function useWatchRoom(code: string): void {
  const hydrated = useGameStore((s) => s.hydrated);
  const watchRoom = useGameStore((s) => s.watchRoom);
  useEffect(() => {
    if (!hydrated || !code) return;
    const stop = watchRoom(code);
    return stop;
  }, [hydrated, code, watchRoom]);
}
