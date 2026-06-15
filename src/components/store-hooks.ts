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
