// POST /api/room/[code]/rollback —— 房主回滚到指定快照。
import { NextResponse } from "next/server";
import { rollbackRemote, RoomError } from "@/server/roomStore";
import { isRemoteConfigured } from "@/server/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { code: string } }) {
  if (!isRemoteConfigured()) {
    return NextResponse.json({ error: "服务端未配置 Supabase。" }, { status: 503 });
  }
  try {
    const body = await req.json();
    const env = await rollbackRemote(params.code.toUpperCase(), Number(body.index), body.token);
    return NextResponse.json(env);
  } catch (e) {
    const status = e instanceof RoomError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "回滚失败。" }, { status });
  }
}
