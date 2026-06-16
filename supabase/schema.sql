-- 《禁闭逃杀》v1.0 数据库 schema（Supabase / PostgreSQL）
--
-- 设计说明：
--   整局游戏状态由纯函数引擎维护在一个 GameRoom 对象里，因此这里直接把
--   GameRoom 作为一行 JSONB 存储，配合 rev 乐观锁实现多端安全写入。
--   秘密令牌(tokens)与历史快照(snapshots)单独成列，不随公共房间数据下发给所有玩家。
--
-- 在 Supabase 控制台 → SQL Editor 粘贴执行本文件即可建表。

create table if not exists public.rooms (
  room_code   text primary key,
  rev         bigint not null default 0,        -- 乐观锁版本号，每次写入 +1
  room        jsonb  not null,                  -- 完整 GameRoom（公共可下发）
  tokens      jsonb  not null default '{}'::jsonb, -- { host: string, players: { [playerId]: token } }
  snapshots   jsonb  not null default '[]'::jsonb, -- 最近若干个阶段快照（仅房主可取）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists rooms_updated_at_idx on public.rooms (updated_at);

-- 本项目所有读写都经由 Next.js 服务端 API（使用 service_role key，绕过 RLS）。
-- 因此默认开启 RLS 且不放开任何匿名策略，避免前端直连篡改。
alter table public.rooms enable row level security;

-- 自动维护 updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_touch_updated_at on public.rooms;
create trigger rooms_touch_updated_at
  before update on public.rooms
  for each row execute function public.touch_updated_at();
