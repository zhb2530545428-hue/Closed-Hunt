"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 地图图片在 v0.1 不存在，统一降级为占位提示，避免裂图
          img: ({ alt }) => (
            <div className="my-3 p-4 bg-ink-700 border border-dashed border-ink-500 rounded text-center text-slate-400 text-sm">
              地图图片未找到{alt ? `（${alt}）` : ""}
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
