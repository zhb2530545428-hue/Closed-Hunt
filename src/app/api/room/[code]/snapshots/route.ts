// GET /api/room/[code]/snapshots?token=xxx —— 房主查看快照列表。
import { NextResponse } from "next/server";
import { listSnapshotsRemote, RoomError } from "@/server/roomStore";
import { isRemoteConfigured } from "@/server/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { code: string } }) {
  if (!isRemoteConfigured()) {
    return NextResponse.json({ error: "服务端未配置 Supabase。" }, { status: 503 });
  }
  try {
    const token = new URL(req.url).searchParams.get("token") ?? undefined;
    const snapshots = await listSnapshotsRemote(params.code.toUpperCase(), token);
    // 仅返回轻量元信息，避免每次拉取整份快照
    return NextResponse.json({
      snapshots: snapshots.map((s, index) => ({
        index,
        label: s.label,
        round: s.round,
        phase: s.phase,
        createdAt: s.createdAt,
      })),
    });
  } catch (e) {
    const status = e instanceof RoomError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "读取失败。" }, { status });
  }
}
