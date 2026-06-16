// POST /api/room —— 创建房间（远程模式）。
import { NextResponse } from "next/server";
import { createRoomRemote, RoomError } from "@/server/roomStore";
import { isRemoteConfigured } from "@/server/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isRemoteConfigured()) {
    return NextResponse.json({ error: "服务端未配置 Supabase，远程模式不可用。" }, { status: 503 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const hostName = String(body.hostName ?? "").trim();
    const devMode = Boolean(body.devMode);
    const result = await createRoomRemote(hostName, devMode);
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof RoomError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "创建失败。" }, { status });
  }
}
