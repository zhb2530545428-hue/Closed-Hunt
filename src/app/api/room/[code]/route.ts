// GET  /api/room/[code] —— 拉取房间（轮询同步）。
// PUT  /api/room/[code] —— 乐观锁写入房间。
import { NextResponse } from "next/server";
import { getRoomRemote, pushRoomRemote, RoomError } from "@/server/roomStore";
import { isRemoteConfigured } from "@/server/supabaseAdmin";

export const dynamic = "force-dynamic";

function guard() {
  if (!isRemoteConfigured()) {
    return NextResponse.json({ error: "服务端未配置 Supabase。" }, { status: 503 });
  }
  return null;
}

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const blocked = guard();
  if (blocked) return blocked;
  try {
    const env = await getRoomRemote(params.code.toUpperCase());
    if (!env) return NextResponse.json({ error: "房间不存在。" }, { status: 404 });
    return NextResponse.json(env);
  } catch (e) {
    const status = e instanceof RoomError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "读取失败。" }, { status });
  }
}

export async function PUT(req: Request, { params }: { params: { code: string } }) {
  const blocked = guard();
  if (blocked) return blocked;
  try {
    const body = await req.json();
    const env = await pushRoomRemote(
      params.code.toUpperCase(),
      body.room,
      Number(body.baseRev),
      body.token
    );
    return NextResponse.json(env);
  } catch (e) {
    const status = e instanceof RoomError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "写入失败。" }, { status });
  }
}
