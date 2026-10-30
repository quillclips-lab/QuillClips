"use client";

import { useId } from "react";

/** Minimal area sparkline. Muted by default; one accent color at most. */
export function Sparkline({ data, height = 64, muted = false }: { data: number[]; height?: number; muted?: boolean }) {
  const id = useId();
  const w = 280;
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const pts = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * w, height - 6 - ((v - min) / (max - min || 1)) * (height - 14)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const stroke = muted ? "#3a3a3a" : "#e7e7e7";
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity={muted ? 0.12 : 0.18} />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray={muted ? "3 3" : undefined} />
    </svg>
  );
}

export function Bars({ data, labels }: { data: number[]; labels?: string[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-2">
      {data.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex h-[72px] w-full items-end">
            <div
              className="w-full rounded-md bg-[#2a2a2a] transition-all duration-700 ease-out data-[last=true]:bg-fg"
              data-last={i === data.length - 1}
              style={{ height: Math.max(3, (v / max) * 72) }}
              title={String(v)}
            />
          </div>
          {labels && <span className="font-mono text-[9.5px] uppercase text-dim">{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

export function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const hot = score >= 85;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f1f1f" strokeWidth="3" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={hot ? "#e5484d" : "#f5f5f4"}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1)" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[14px] font-medium">{score}</span>
    </div>
  );
}
