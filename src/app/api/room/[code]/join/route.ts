// POST /api/room/[code]/join —— 加入座位 / 重连。
import { NextResponse } from "next/server";
import { joinSeatRemote, RoomError } from "@/server/roomStore";
import { isRemoteConfigured } from "@/server/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { code: string } }) {
  if (!isRemoteConfigured()) {
    return NextResponse.json({ error: "服务端未配置 Supabase。" }, { status: 503 });
  }
  try {
    const body = await req.json();
    const result = await joinSeatRemote(
      params.code.toUpperCase(),
      Number(body.seatIndex),
      String(body.name ?? ""),
      body.token
    );
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof RoomError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "加入失败。" }, { status });
  }
}
