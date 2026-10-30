"use client";

import { useState } from "react";
import { api, url, type Clip, type EditStyle, type SharePlatform } from "@/lib/api";
import { CLIP_STATUS_TR, EDIT_STYLE_TR, SCORE_TR, TAG_TR, dateTime, tc } from "@/lib/format";
import { ScoreRing } from "./charts";
import EditPlan from "./EditPlan";
import { IconDownload, IconFilm, IconPlay, IconRefresh, IconSpark, PlatformIcon } from "./icons";
import { Badge, Button, CopyButton, cx, ErrorBox, Progress, RecDot, Skeleton } from "./ui";

const RENDER_STAGES = ["Konuşmacı tespiti", "Kurgu planı", "Render"];

function stageIndex(stage: string | null): number {
  if (!stage) return -1;
  if (stage.startsWith("Konuşmacı")) return 0;
  if (stage.startsWith("Kurgu")) return 1;
  return 2; // Render (hazırlık) / Render / Ses miksajı / Son işlemler
}

function TextBlock({ label, text, mono }: { label: string; text?: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-[#0a0a0a] p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        {text ? <CopyButton text={text} /> : null}
      </div>
      {text ? (
        <p className={cx("whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#dcdcdc]", mono && "font-mono text-[12px]")}>{text}</p>
      ) : (
        <Skeleton className="h-10 w-full" />
      )}
    </div>
  );
}

export function Player({ clip, className }: { clip: Clip; className?: string }) {
  const [play, setPlay] = useState(false);
  return (
    <div className={cx("relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-line bg-[#0a0a0a]", className)}>
      {clip.status === "done" && clip.file_url ? (
        play ? (
          <video src={url(clip.file_url)} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
        ) : (
          <button type="button" onClick={() => setPlay(true)} className="group absolute inset-0">
            {clip.thumb_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url(clip.thumb_url)} alt="" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/30">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/30 bg-black/40 text-white backdrop-blur transition-transform group-hover:scale-105">
                <IconPlay size={20} />
              </span>
            </span>
            {clip.duration && (
              <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10.5px] text-white">{tc(clip.duration)}</span>
            )}
          </button>
        )
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5">
          <div className="skeleton absolute inset-0 rounded-none opacity-60" />
          <div className="relative flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-widest text-muted">
            {clip.status === "rendering" || clip.status === "queued" ? <RecDot /> : null}
            {clip.status === "rendering" ? clip.stage || "Render" : CLIP_STATUS_TR[clip.status]}
          </div>
          {clip.status === "rendering" && (
            <ol className="relative space-y-1.5">
              {RENDER_STAGES.map((s, i) => {
                const cur = stageIndex(clip.stage);
                return (
                  <li key={s} className={cx("flex items-center gap-2 text-[11.5px]", i > cur ? "text-dim" : i === cur ? "text-fg" : "text-muted")}>
                    <span className={cx("h-1.5 w-1.5 rounded-full", i < cur ? "bg-muted" : i === cur ? "bg-rec" : "bg-[#2a2a2a]")} />
                    {s}
                  </li>
                );
              })}
            </ol>
          )}
          {(clip.status === "rendering" || clip.status === "queued") && (
            <div className="relative w-3/4">
              <Progress value={clip.progress} />
              <div className="mt-2 text-center font-mono text-[11px] text-muted">{Math.round(clip.progress * 100)}%</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ShareMarks({ clip, onChange }: { clip: Clip; onChange: (c: Clip) => void }) {
  const platforms: SharePlatform[] = ["youtube", "tiktok", "instagram"];
  return (
    <div className="flex flex-wrap gap-2">
      {platforms.map((p) => {
        const ts = clip.shared?.[p];
        return (
          <button
            key={p}
            type="button"
            title={ts ? `Paylaşıldı: ${dateTime(ts)}` : "Paylaşıldı olarak işaretle"}
            onClick={async () => {
              const c = await api<Clip>(`/api/clips/${clip.id}`, { method: "PATCH", json: { shared: { [p]: !ts } } });
              onChange(c);
            }}
            className={cx(
              "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] transition-all",
              ts ? "border-fg/70 bg-[#151515] text-fg" : "border-line-2 text-muted opacity-70 hover:opacity-100",
            )}
          >
            <span className={cx(!ts && "grayscale")}>
              <PlatformIcon platform={p} size={14} />
            </span>
            {ts ? new Date(ts * 1000).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }) : "Paylaşılmadı"}
          </button>
        );
      })}
    </div>
  );
}

function Nudge({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="label w-12">{label}</span>
      {[-3, -1].map((d) => (
        <button key={d} type="button" onClick={() => onChange(value + d)} className="h-7 rounded-lg border border-line-2 px-2 font-mono text-[11px] text-muted transition-colors hover:border-[#3a3a3a] hover:text-fg">
          {d}s
        </button>
      ))}
      <span className={cx("w-12 text-center font-mono text-[12px]", value !== 0 ? "text-fg" : "text-dim")}>
        {value > 0 ? `+${value}` : value}s
      </span>
      {[1, 3].map((d) => (
        <button key={d} type="button" onClick={() => onChange(value + d)} className="h-7 rounded-lg border border-line-2 px-2 font-mono text-[11px] text-muted transition-colors hover:border-[#3a3a3a] hover:text-fg">
          +{d}s
        </button>
      ))}
    </div>
  );
}

export default function ClipCard({ clip, onChange, delay = 0 }: { clip: Clip; onChange: (c: Clip) => void; delay?: number }) {
  const [ds, setDs] = useState(0);
  const [de, setDe] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [alts, setAlts] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [editStyle, setEditStyle] = useState<EditStyle | null>(null);
  const m = clip.metadata || {};
  // campaign clips only get captions for the campaign's platforms; while pending show every slot
  const pendingMeta = Object.keys(m).length === 0;
  const hasField = (k: keyof typeof m) => pendingMeta || k in m;
  const busyRender = clip.status === "rendering" || clip.status === "queued";
  const style: EditStyle = editStyle ?? clip.render_opts?.edit_style ?? clip.edit?.style ?? "balanced";

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const rerender = () =>
    run("render", async () => {
      const c = await api<Clip>(`/api/clips/${clip.id}/rerender`, { method: "POST", json: { start_delta: ds, end_delta: de } });
      setDs(0);
      setDe(0);
      onChange(c);
    });

  const reedit = () =>
    run("reedit", async () => {
      onChange(await api<Clip>(`/api/clips/${clip.id}/reedit`, { method: "POST", json: { edit_style: style } }));
      setEditStyle(null);
    });

  return (
    <article
      className="grid grid-cols-1 gap-5 rounded-[var(--radius-bento)] border border-line bg-card p-4 animate-fade-up md:grid-cols-[260px_1fr] md:p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mx-auto w-full max-w-[260px]">
        <Player clip={clip} />
        <div className="mt-3 flex gap-2">
          <a
            href={clip.file_url ? url(`/api/clips/${clip.id}/file?download=1`) : undefined}
            className={cx(
              "inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-full text-[13px] font-medium transition-all",
              clip.status === "done" ? "bg-fg text-ink hover:bg-white" : "pointer-events-none bg-[#1a1a1a] text-dim",
            )}
          >
            <IconDownload size={15} /> İndir (MP4)
          </a>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex shrink-0 gap-3">
            {clip.relevance_score != null && (
              <div className="flex flex-col items-center gap-1">
                <ScoreRing score={clip.relevance_score} />
                <span className="font-mono text-[9.5px] uppercase tracking-wider text-dim">Alaka</span>
              </div>
            )}
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={clip.score} />
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-dim">Viral</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label">Klip {String(clip.idx + 1).padStart(2, "0")}</span>
              <span className="font-mono text-[11px] text-muted">
                {tc(clip.start, true)} → {tc(clip.end, true)} · {Math.round(clip.end - clip.start)}s
              </span>
              {clip.campaign_name && <Badge>{clip.campaign_name}</Badge>}
              {clip.status !== "done" && <Badge tone={clip.status === "error" || clip.status === "paused" ? "rec" : "default"}>{CLIP_STATUS_TR[clip.status]}</Badge>}
            </div>
            {clip.relevance_reason && (
              <p className="mt-1.5 text-[13.5px] leading-snug text-[#e6e6e6]">
                <span className="text-muted">Brief&apos;e uygunluk: </span>
                {clip.relevance_reason}
              </p>
            )}
            <p className="mt-1 text-[13.5px] leading-snug text-[#e6e6e6]">
              <span className="text-muted">Neden viral? </span>
              {clip.why_viral}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {clip.tags?.map((t) => (
                <span key={t} className="rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-muted">
                  {TAG_TR[t] ?? t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {clip.scores && Object.keys(clip.scores).length > 0 && (
          <div className="grid grid-cols-4 gap-x-4 gap-y-2 sm:grid-cols-7">
            {Object.entries(clip.scores).map(([k, v]) => (
              <div key={k}>
                <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-dim">{SCORE_TR[k] ?? k}</div>
                <div className="h-[3px] rounded-full bg-[#1c1c1c]">
                  <div className="h-full rounded-full bg-[#cfcfcf]" style={{ width: `${(v / 10) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {clip.hook_text && clip.render_opts?.hook && (
          <div className="rounded-2xl border border-line bg-[#0a0a0a] px-3.5 py-3">
            <div className="label mb-1">Hook</div>
            <p className="font-display text-[15px] font-medium">{clip.hook_text}</p>
          </div>
        )}

        {(clip.status === "error" || clip.status === "paused") && clip.error && (
          <ErrorBox
            message={clip.error}
            onRetry={() => run("retry", async () => onChange(await api<Clip>(`/api/clips/${clip.id}/retry`, { method: "POST" })))}
            retryLabel={clip.status === "paused" ? "Devam et" : "Tekrar dene"}
          />
        )}
        {clip.status === "done" && clip.error && (
          <ErrorBox
            message={clip.error}
            onRetry={() => run("retry", async () => onChange(await api<Clip>(`/api/clips/${clip.id}/retry`, { method: "POST" })))}
            retryLabel="Tekrar dene"
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-[#0a0a0a] p-3">
          <div className="space-y-2">
            <Nudge label="Başla" value={ds} onChange={setDs} />
            <Nudge label="Bitir" value={de} onChange={setDe} />
          </div>
          <Button size="sm" variant={ds || de ? "primary" : "outline"} loading={busy === "render"} onClick={rerender} disabled={busyRender}>
            <IconRefresh size={14} /> Yeniden render
          </Button>
        </div>

        <div className="rounded-2xl border border-line bg-[#0a0a0a] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label mr-auto flex items-center gap-2">
              <IconFilm size={13} /> Kurgu
              {clip.edit && (
                <span className="normal-case tracking-normal text-muted">
                  · {EDIT_STYLE_TR[clip.edit.style] ?? clip.edit.style}
                  {clip.edit.fallback ? " · yedek plan" : ""}
                </span>
              )}
            </span>
            <Button size="sm" variant="ghost" disabled={!clip.edit} onClick={() => setShowPlan((x) => !x)}>
              {showPlan ? "Kurgu planını gizle" : "Kurgu planını göster"}
            </Button>
            <div className="flex items-center gap-1 rounded-full border border-line-2 p-0.5">
              {(["minimal", "balanced", "aggressive"] as EditStyle[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setEditStyle(s)}
                  className={cx("h-7 rounded-full px-2.5 text-[11.5px] transition-colors", style === s ? "bg-fg text-ink" : "text-muted hover:text-fg")}
                >
                  {EDIT_STYLE_TR[s]}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" loading={busy === "reedit"} disabled={busyRender} onClick={reedit}>
              <IconSpark size={13} /> Kurguyu yeniden üret
            </Button>
          </div>
          {showPlan && clip.edit && (
            <div className="mt-3 border-t border-line pt-3">
              <EditPlan clipId={clip.id} version={clip.updated_at} />
            </div>
          )}
        </div>

        {hasField("youtube_title") && (
        <div className="rounded-2xl border border-line bg-[#0a0a0a] p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="label flex items-center gap-2">
              <PlatformIcon platform="youtube" size={13} /> YouTube Shorts başlığı
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => run("titles", async () => setAlts((await api<{ titles: string[] }>(`/api/clips/${clip.id}/titles`, { method: "POST" })).titles))}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-2 px-2.5 font-mono text-[10.5px] uppercase tracking-wider text-muted transition-colors hover:border-[#3a3a3a] hover:text-fg"
              >
                {busy === "titles" ? <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" /> : <IconSpark size={12} />}
                Yeniden üret
              </button>
              {m.youtube_title && <CopyButton text={m.youtube_title} />}
            </div>
          </div>
          {m.youtube_title ? (
            <p className="font-display text-[17px] font-medium leading-snug">{m.youtube_title}</p>
          ) : (
            <Skeleton className="h-6 w-4/5" />
          )}
          {m.youtube_title && <div className="mt-1 font-mono text-[10.5px] text-dim">{m.youtube_title.length}/100</div>}
          {alts && (
            <div className="mt-3 space-y-1.5 border-t border-line pt-3">
              <div className="label mb-1">Alternatifler (seçmek için tıkla)</div>
              {alts.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    run("pick", async () => {
                      onChange(await api<Clip>(`/api/clips/${clip.id}`, { method: "PATCH", json: { metadata: { youtube_title: t } } }));
                      setAlts(null);
                    })
                  }
                  className="block w-full rounded-xl border border-line px-3 py-2 text-left text-[13.5px] text-[#ddd] transition-colors hover:border-line-2 hover:bg-[#111]"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        {err && <ErrorBox message={err} />}

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {hasField("youtube_description") && <TextBlock label="YouTube açıklaması" text={m.youtube_description} />}
          {hasField("tiktok_caption") && <TextBlock label="TikTok caption" text={m.tiktok_caption} />}
          {hasField("instagram_caption") && <TextBlock label="Instagram caption" text={m.instagram_caption} />}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ShareMarks clip={clip} onChange={onChange} />
          {pendingMeta && clip.status !== "queued" && (
            <Button size="sm" variant="ghost" loading={busy === "meta"} onClick={() => run("meta", () => api(`/api/clips/${clip.id}/metadata`, { method: "POST" }))}>
              Metinleri yeniden üret
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
