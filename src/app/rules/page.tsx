import fs from "fs";
import path from "path";
import Link from "next/link";
import { MarkdownView } from "@/components/MarkdownView";

export const dynamic = "force-dynamic";

// 实际文件名为「禁闭逃杀_规则手册.md」（无空格）。开发指令中提到的空格与真实文件不符，按真实文件读取。
const CANDIDATE_FILES = ["禁闭逃杀_规则手册.md", "禁闭逃杀_规则手册 .md"];

function readRules(): string | null {
  for (const name of CANDIDATE_FILES) {
    const p = path.join(process.cwd(), name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }
  return null;
}

export default function RulesPage() {
  const content = readRules();
  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gold">规则手册</h1>
        <Link href="/" className="text-blue-400 underline text-sm">
          返回首页
        </Link>
      </div>
      {content ? (
        <MarkdownView content={content} />
      ) : (
        <p className="text-red-300">未找到规则手册文件。</p>
      )}
    </main>
  );
}
