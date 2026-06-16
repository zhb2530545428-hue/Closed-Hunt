// 本浏览器身份（含密钥令牌）持久化在 localStorage，按房间码区分。
// 刷新 / 断线后据此恢复座位与写入权限。

import type { LocalIdentity } from "@/shared/sync";

const PREFIX = "closed-hunt:id:";

export function loadIdentity(code: string): LocalIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + code);
    return raw ? (JSON.parse(raw) as LocalIdentity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: LocalIdentity): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFIX + id.code, JSON.stringify(id));
}

export function clearIdentity(code: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PREFIX + code);
}

/** 读取本浏览器所有房间身份（hydrate 时用）。 */
export function loadAllIdentities(): Record<string, LocalIdentity> {
  if (typeof window === "undefined") return {};
  const out: Record<string, LocalIdentity> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(PREFIX)) {
      try {
        const id = JSON.parse(window.localStorage.getItem(key)!) as LocalIdentity;
        out[id.code] = id;
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}
