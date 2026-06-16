"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { isRemoteMode } from "@/store/sync";
import { useEnsureHydrated } from "@/components/store-hooks";
import { Button, Card } from "@/components/ui";

export default function HomePage() {
  const hydrated = useEnsureHydrated();
  const router = useRouter();
  const createRoom = useGameStore((s) => s.createRoom);
  const rooms = useGameStore((s) => s.rooms);

  const [hostName, setHostName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [devMode, setDevMode] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const remote = isRemoteMode();

  const handleCreate = async () => {
    if (!hostName.trim()) return setError("请先填写房主昵称。");
    setError("");
    setBusy(true);
    try {
      const code = await createRoom(hostName.trim(), devMode);
      router.push(`/room/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败。");
      setBusy(false);
    }
  };

  const handleJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return setError("请输入房间码。");
    // 远程模式由房间页向服务端校验是否存在；本地模式校验本机是否有该房间
    if (!remote && hydrated && !rooms[code]) {
      return setError("房间码不存在（本地模式下房间仅存于创建它的浏览器内）。");
    }
    router.push(`/room/${code}`);
  };

  return (
    <main className="max-w-md mx-auto px-4 py-10">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-black tracking-widest text-blood">禁闭逃杀</h1>
        <p className="text-slate-400 mt-2 text-sm">电子版 v1.0 · 9 人局秘密移动生存博弈</p>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded p-2">
          {error}
        </div>
      )}

      <Card title="创建房间" className="mb-4">
        <label className="block text-sm text-slate-400 mb-1">房主昵称</label>
        <input
          className="w-full bg-ink-700 border border-ink-600 rounded px-3 py-2 mb-3"
          value={hostName}
          onChange={(e) => setHostName(e.target.value)}
          placeholder="请输入昵称"
          maxLength={12}
        />
        <label className="flex items-center gap-2 text-sm text-slate-400 mb-3 select-none">
          <input
            type="checkbox"
            checked={devMode}
            onChange={(e) => setDevMode(e.target.checked)}
          />
          开发调试模式（允许少于 9 人开始）
        </label>
        <Button variant="primary" className="w-full" onClick={handleCreate} disabled={busy}>
          {busy ? "创建中…" : "创建房间"}
        </Button>
      </Card>

      <Card title="加入房间" className="mb-4">
        <label className="block text-sm text-slate-400 mb-1">房间码</label>
        <input
          className="w-full bg-ink-700 border border-ink-600 rounded px-3 py-2 mb-3 uppercase tracking-widest"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="6 位房间码"
          maxLength={6}
        />
        <Button variant="gold" className="w-full" onClick={handleJoin}>
          加入房间
        </Button>
      </Card>

      <div className="text-center">
        <Link href="/rules" className="text-blue-400 underline text-sm">
          查看规则手册
        </Link>
      </div>

      <p className="text-xs text-slate-500 mt-8 text-center leading-relaxed">
        {remote ? (
          <>真实多人模式：任何设备打开邀请链接即可加入，<br />刷新可自动重连座位。</>
        ) : (
          <>本地模式（未配置 Supabase）：房间数据仅存于本机 localStorage，<br />同一浏览器多标签页可热座测试。配置环境变量后即开启真实多人。</>
        )}
      </p>
    </main>
  );
}
