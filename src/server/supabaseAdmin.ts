// 服务端 Supabase 客户端（使用 service_role key，仅在 Next.js 服务端运行）。
// 若未配置环境变量，则远程模式不可用，前端会自动回退到 localStorage 单机模式。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** 远程（Supabase）模式是否启用：服务端判定。 */
export function isRemoteConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** 获取服务端 Supabase 客户端；未配置时抛错。 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("未配置 Supabase 环境变量，远程多人模式不可用。");
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const ROOMS_TABLE = "rooms";
