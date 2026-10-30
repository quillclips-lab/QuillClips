"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import ClipCard from "@/components/ClipCard";
import { IconDownload, IconPlay, IconSearch, IconX, PlatformIcon } from "@/components/icons";
import { Button, cx, ErrorBox, Input, PageHeader, Progress, Select, Skeleton, Toast } from "@/components/ui";
import { url, type Campaign, type Clip, type SharePlatform, type Video } from "@/lib/api";
import { CATEGORY_TR, CLIP_STATUS_TR, relTime, tc } from "@/lib/format";
import { usePoll, useToast } from "@/lib/hooks";

const DATE_RANGES = [
  { value: "", label: "Tüm zamanlar" },
  { value: "1", label: "Son 24 saat" },
  { value: "7", label: "Son 7 gün" },
  { value: "30", label: "Son 30 gün" },
];

function Inventory() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [videoId, setVideoId] = useState("");
  const [campaignId, setCampaignId] = useState(params.get("campaign") || "");
  const [category, setCategory] = useState("");
  const [minScore, setMinScore] = useState("0");
  const [days, setDays] = useState("");
  const [since, setSince] = useState("");
  const [status, setStatus] = useState("");
  const [shared, setShared] = useState(params.get("shared") || "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const { toast, show } = useToast();
  const openId = params.get("clip");

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (videoId) p.set("video_id", videoId);
    if (status) p.set("status", status);
    if (Number(minScore) > 0) p.set("min_score", minScore);
    if (category) p.set("category", category);
    if (campaignId) p.set("campaign_id", campaignId);
    if (shared) p.set("shared", shared);
    if (since) p.set("since", since);
    return `/api/clips?${p.toString()}`;
  }, [videoId, status, minScore, category, campaignId, shared, since]);

  const { data: clips, error, setData, refresh } = usePoll<Clip[]>(query, 4000);
  const { data: videos } = usePoll<Video[]>("/api/videos");
  const { data: campaigns } = usePoll<Campaign[]>("/api/campaigns");
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = useMemo(() => {
    if (!clips) return null;
    if (!qDebounced) return clips;
    return clips.filter((c) =>
      [c.metadata.youtube_title, c.summary, c.hook_text, c.video_filename, c.text, c.person?.username, c.campaign_name].join(" ").toLowerCase().includes(qDebounced),
    );
  }, [clips, qDebounced]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    (videos || []).forEach((v) => v.analysis?.primary_category && set.add(v.analysis.primary_category));
    return [...set].sort();
  }, [videos]);

  const open = openId ? (clips || []).find((c) => c.id === openId) : null;
  const update = (c: Clip) => setData((list) => (list ? list.map((x) => (x.id === c.id ? c : x)) : list));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function downloadZip() {
    setZipping(true);
    try {
      const res = await fetch(url("/api/clips/zip"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || "Zip oluşturulamadı");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `quillclips_${selected.size}_klip.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      show((e as Error).message, "err");
    } finally {
      setZipping(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="QuillClips / Envanter"
        title="Envanter"
        right={
          <div className="w-full max-w-sm sm:w-80">
            <div className="relative">
              <IconSearch size={15} className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Başlık, özet, yayıncı ara…" className="pl-8" />
            </div>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Select value={videoId} onChange={setVideoId} options={[{ value: "", label: "Tüm videolar" }, ...(videos || []).map((v) => ({ value: v.id, label: v.filename }))]} />
        <Select
          value={campaignId}
          onChange={setCampaignId}
          options={[{ value: "", label: "Tüm kampanyalar" }, { value: "none", label: "Kampanyasız" }, ...(campaigns || []).map((c) => ({ value: c.id, label: c.name }))]}
        />
        <Select value={category} onChange={setCategory} options={[{ value: "", label: "Tüm kategoriler" }, ...categoryOptions.map((c) => ({ value: c, label: CATEGORY_TR[c] ?? c }))]} />
        <Select
          value={minScore}
          onChange={setMinScore}
          options={[
            { value: "0", label: "Her skor" },
            { value: "60", label: "Skor 60+" },
            { value: "75", label: "Skor 75+" },
            { value: "85", label: "Skor 85+" },
          ]}
        />
        <Select
          value={days}
          onChange={(d) => {
            setDays(d);
            setSince(d ? String(Math.floor(Date.now() / 1000 - Number(d) * 86400)) : "");
          }}
          options={DATE_RANGES}
        />
        <Select value={status} onChange={setStatus} options={[{ value: "", label: "Her durum" }, ...Object.entries(CLIP_STATUS_TR).map(([value, label]) => ({ value, label }))]} />
        <Select
          value={shared}
          onChange={setShared}
          options={[
            { value: "", label: "Paylaşım: hepsi" },
            { value: "none", label: "Paylaşılmamış" },
            { value: "youtube", label: "YouTube'da" },
            { value: "tiktok", label: "TikTok'ta" },
            { value: "instagram", label: "Instagram'da" },
          ]}
        />
      </div>

      {selected.size > 0 && (
        <div className="sticky top-3 z-30 mb-4 flex items-center justify-between gap-3 rounded-full border border-line-2 bg-[#0e0e0e]/95 py-2 pl-5 pr-2 backdrop-blur animate-fade-up">
          <span className="text-[13.5px]">{selected.size} klip seçildi</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Temizle
            </Button>
            <Button size="sm" variant="primary" loading={zipping} onClick={downloadZip}>
              <IconDownload size={14} /> Zip olarak indir
            </Button>
          </div>
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={refresh} />}
      {!filtered ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[9/16]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[var(--radius-bento)] border border-line bg-card py-16 text-center text-[14px] text-muted">Filtrelere uyan klip yok.</div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="label">{filtered.length} klip</span>
            <button
              type="button"
              className="font-mono text-[11px] uppercase tracking-wider text-muted hover:text-fg"
              onClick={() => setSelected(new Set(filtered.filter((c) => c.status === "done").map((c) => c.id)))}
            >
              Tümünü seç
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {filtered.map((c, i) => (
              <div key={c.id} className="group animate-fade-up" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-card transition-all duration-300 group-hover:border-line-2">
                  <button type="button" className="absolute inset-0" onClick={() => router.push(`/envanter?clip=${c.id}`, { scroll: false })}>
                    {c.thumb_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url(c.thumb_url)} alt="" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
                    ) : (
                      <div className="skeleton h-full w-full rounded-none opacity-60" />
                    )}
                    <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30" />
                    {c.status !== "done" && (
                      <span className="absolute inset-x-3 top-1/2 -translate-y-1/2 text-center">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">{CLIP_STATUS_TR[c.status]}</span>
                        {(c.status === "rendering" || c.status === "queued") && (
                          <span className="mt-2 block">
                            <Progress value={c.progress} />
                          </span>
                        )}
                      </span>
                    )}
                    <span className="absolute bottom-0 left-0 right-0 p-3 text-left">
                      <span className="line-clamp-2 text-[12.5px] font-medium leading-snug text-white">{c.metadata.youtube_title || c.summary}</span>
                      <span className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-white/60">
                        {c.duration ? tc(c.duration) : "--:--"} · {relTime(c.created_at)}
                      </span>
                    </span>
                    <span className={cx("absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 font-mono text-[11px]", c.score >= 85 ? "bg-rec text-white" : "bg-black/60 text-white")}>
                      {c.score}
                    </span>
                    {c.status === "done" && (
                      <span className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/40 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                        <IconPlay size={16} />
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    disabled={c.status !== "done"}
                    className={cx(
                      "absolute left-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-md border transition-all",
                      selected.has(c.id) ? "border-fg bg-fg text-ink" : "border-white/40 bg-black/40 text-transparent opacity-0 group-hover:opacity-100",
                      c.status !== "done" && "hidden",
                    )}
                    aria-label="Seç"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.6" fill="none" />
                    </svg>
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-1.5 px-0.5">
                  {(["youtube", "tiktok", "instagram"] as SharePlatform[]).map((p) => (
                    <span key={p} className={cx("transition-opacity", c.shared?.[p] ? "opacity-100" : "opacity-20 grayscale")} title={c.shared?.[p] ? "Paylaşıldı" : "Paylaşılmadı"}>
                      <PlatformIcon platform={p} size={14} />
                    </span>
                  ))}
                  <span className="ml-auto truncate font-mono text-[10.5px] text-dim">{c.category ? CATEGORY_TR[c.category] ?? c.category : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm md:p-10" onClick={() => router.push("/envanter", { scroll: false })}>
          <div className="relative w-full max-w-5xl animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="label truncate">{open.video_filename}</span>
              <button type="button" onClick={() => router.push("/envanter", { scroll: false })} className="flex h-9 w-9 items-center justify-center rounded-full border border-line-2 bg-card text-muted hover:text-fg">
                <IconX size={16} />
              </button>
            </div>
            <ClipCard clip={open} onChange={update} />
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </>
  );
}

export default function EnvanterPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Inventory />
    </Suspense>
  );
}
