"use client";

import React from "react";

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "ghost" | "danger" | "gold";

const variantClass: Record<BtnVariant, string> = {
  primary: "bg-blood hover:bg-red-700 text-white",
  ghost: "bg-ink-700 hover:bg-ink-600 text-slate-200 border border-ink-600",
  danger: "bg-red-900 hover:bg-red-800 text-red-100 border border-red-700",
  gold: "bg-gold hover:bg-yellow-600 text-ink-900 font-semibold",
};

export function Button({
  variant = "ghost",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      {...props}
      className={cls(
        "px-3 py-2 rounded-md text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[40px]",
        variantClass[variant],
        className
      )}
    />
  );
}

export function Card({
  title,
  children,
  className,
  right,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className={cls("bg-ink-800 border border-ink-600 rounded-lg p-4", className)}>
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-100">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "toxic" | "blood" | "gold" | "shadow";
}) {
  const map = {
    default: "bg-ink-600 text-slate-200",
    toxic: "bg-toxic/20 text-toxic border border-toxic/40",
    blood: "bg-blood/20 text-red-300 border border-blood/40",
    gold: "bg-gold/20 text-gold border border-gold/40",
    shadow: "bg-purple-900/40 text-purple-300 border border-purple-700",
  };
  return (
    <span className={cls("inline-block px-2 py-0.5 rounded text-xs", map[tone])}>
      {children}
    </span>
  );
}
