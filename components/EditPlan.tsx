"use client";

import { useEffect, useState } from "react";
import { api, type EdlEvent, type EdlView } from "@/lib/api";
import { EDIT_STYLE_TR, tc } from "@/lib/format";
import { cx, ErrorBox, Skeleton } from "./ui";

const KIND: Record<EdlEvent["kind"], { label: string; color: string }> = {
  cut: { label: "Kesim", color: "#e5484d" },
  shot: { label: "Kadraj", color: "#8a8a8a" },
  zoom: { label: "Zoom", color: "#f5f5f4" },
  text: { label: "Yazı", color: "#FFD400" },
  "3d": { label: "3D", color: "#ff9f43" },
  label: { label: "Etiket", color: "#5ac8fa" },
  transition: { label: "Geçiş", color: "#b18cff" },
  sfx: { label: "SFX", color: "#3ddc84" },
};
const FACE_COLORS = ["#f5f5f4", "#5ac8fa", "#ff9f43", "#b18cff", "#3ddc84"];
const GRADE_TR: Record<string, string> = { clean: "Clean", warm: "Warm", cinematic: "Cinematic", punchy: "Punchy" };
const LANES: EdlEvent["kind"][] = ["cut", "zoom", "text", "3d", "label", "transition", "sfx"];

/** Readable view of a clip's EDL: speaker lane, effect lanes and a time-sorted event list. */
export default function EditPlan({ clipId, version }: { clipId: string; version: number }) {
  const [data, setData] = useState<EdlView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<EdlView>(`/api/clips/${clipId}/edl`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [clipId, version]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Skeleton className="h-40 w-full" />;

  const D = Math.max(0.1, data.clip_duration);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / D) * 100))}%`;
  const width = (s: number, e: number | null) => `${Math.max(0.6, (((e ?? s) - s) / D) * 100)}%`;
  const removed = data.events.filter((e) => e.kind === "cut").reduce((s, e) => s + ((e.end ?? e.t) - e.t), 0);
  const faceIds = Object.keys(data.faces);

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-muted">
        <span>
          Stil <span className="text-fg">{EDIT_STYLE_TR[data.style] ?? data.style}</span>
        </span>
        <span>
          Renk <span className="text-fg">{GRADE_TR[data.grade] ?? data.grade}</span>
        </span>
        <span>
          Kesilen <span className="text-fg">{removed.toFixed(1)} sn</span>
        </span>
        <span>
          Çıktı <span className="text-fg">{tc(data.output_duration, true)}</span>
        </span>
        <span>
          Yüz <span className="text-fg">{faceIds.length}</span>
        </span>
        {data.music && (
          <span>
            Müzik <span className="text-fg">{data.music}</span>
          </span>
        )}
        {data.fallback && <span className="text-rec">Yedek plan (Claude yanıt vermedi)</span>}
      </div>
      {data.summary && <p className="text-[13.5px] leading-relaxed text-[#dcdcdc]">{data.summary}</p>}

      <div className="space-y-1.5 rounded-xl border border-line bg-[#080808] p-3">
        <Lane label="Konuşan">
          {data.speakers.map((s, i) => (
            <span
              key={i}
              title={`${tc(s.start, true)}–${tc(s.end, true)} · ID ${s.face}`}
              className="absolute top-0 h-full rounded-[3px]"
              style={{ left: pct(s.start), width: width(s.start, s.end), background: FACE_COLORS[s.face % FACE_COLORS.length], opacity: 0.55 }}
            />
          ))}
        </Lane>
        {LANES.map((k) => {
          const evs = data.events.filter((e) => e.kind === k);
          if (!evs.length) return null;
          return (
            <Lane key={k} label={KIND[k].label}>
              {evs.map((e, i) => (
                <span
                  key={i}
                  title={`${tc(e.t, true)} · ${e.text}`}
                  className={cx("absolute top-0 h-full", e.end == null ? "w-[3px] rounded-full" : "rounded-[3px]")}
                  style={{ left: pct(e.t), width: e.end == null ? undefined : width(e.t, e.end), background: KIND[k].color, opacity: k === "cut" ? 0.85 : 0.75 }}
                />
              ))}
            </Lane>
          );
        })}
        <div className="flex justify-between pl-[68px] font-mono text-[9.5px] text-dim">
          <span>0:00</span>
          <span>{tc(D / 2)}</span>
          <span>{tc(D)}</span>
        </div>
      </div>

      {faceIds.length > 1 && (
        <div className="flex flex-wrap gap-3 text-[11.5px] text-muted">
          {faceIds.map((id) => {
            const f = data.faces[id];
            return (
              <span key={id} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: FACE_COLORS[Number(id) % FACE_COLORS.length] }} />
                ID {id} · {f.center_x < 0.4 ? "solda" : f.center_x > 0.6 ? "sağda" : "ortada"} · %{Math.round(f.coverage * 100)} görünür
              </span>
            );
          })}
        </div>
      )}

      <ol className="max-h-[260px] space-y-1 overflow-y-auto pr-1">
        {data.events
          .filter((e) => e.kind !== "shot" || data.events.filter((x) => x.kind === "shot").length > 1)
          .map((e, i) => (
            <li key={i} className="flex items-baseline gap-3 rounded-lg px-2 py-1 text-[12.5px] hover:bg-[#101010]">
              <span className="w-[86px] shrink-0 font-mono text-[11px] text-muted">
                {tc(e.t, true)}
                {e.end != null && e.end - e.t >= 0.3 ? `–${tc(e.end, true).slice(-4)}` : ""}
              </span>
              <span className="w-[54px] shrink-0 font-mono text-[10px] uppercase tracking-wider" style={{ color: KIND[e.kind].color }}>
                {KIND[e.kind].label}
              </span>
              <span className="min-w-0 text-[#d6d6d6]">{e.text}</span>
            </li>
          ))}
      </ol>
    </div>
  );
}

function Lane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[60px] shrink-0 text-right font-mono text-[9.5px] uppercase tracking-wider text-dim">{label}</span>
      <div className="relative h-3 flex-1 rounded-[3px] bg-[#141414]">{children}</div>
    </div>
  );
}
