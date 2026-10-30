"use client";

import Link from "next/link";
import { useState } from "react";
import Uploader from "@/components/Uploader";
import { IconChevron } from "@/components/icons";
import { Badge, Card, Field, Input, PageHeader, Progress, RecDot, Select, Skeleton, Textarea } from "@/components/ui";
import { url, type Campaign, type Video } from "@/lib/api";
import { BRIEF_PLACEHOLDER, CATEGORY_TR, EXCLUDE_PLACEHOLDER, STATUS_TR, bytes, money, relTime, tc } from "@/lib/format";
import { usePoll } from "@/lib/hooks";

const STEPS = [
  ["01", "Transkript", "faster-whisper, kelime düzeyinde zaman"],
  ["02", "Analiz + brief", "Opus ana temayı ve kişiyi çıkarır, brief önerir"],
  ["03", "Seçim", "Alaka skoru önce, viral skor sonra"],
  ["04", "Konuşmacı tespiti", "Yüz takibi + ağız hareketi"],
  ["05", "Kurgu planı", "Opus EDL: kesim, zoom, yazı, SFX"],
  ["06", "Render", "Remotion 9:16, ses miksajı"],
];

export default function UretimPage() {
  const { data: videos } = usePoll<Video[]>("/api/videos", 3000);
  const { data: campaigns } = usePoll<Campaign[]>("/api/campaigns");
  const [brief, setBrief] = useState("");
  const [exclude, setExclude] = useState("");
  const [campaignId, setCampaignId] = useState("");

  return (
    <>
      <PageHeader eyebrow="QuillClips / Üretim" title="Uzun videodan viral kliplere" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <Uploader context={{ brief, exclude, campaign_id: campaignId || null }} />
        </div>
        <Card label="Brief" className="flex flex-col xl:col-span-5" delay={80} right={<span className="font-mono text-[10.5px] text-dim">opsiyonel</span>}>
          <div className="flex flex-1 flex-col gap-3">
            <Textarea rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={BRIEF_PLACEHOLDER} />
            <Input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder={EXCLUDE_PLACEHOLDER} />
            <Field label="Kampanya">
              <Select
                value={campaignId}
                onChange={setCampaignId}
                options={[{ value: "", label: campaigns?.length ? "Kampanyasız" : "Kayıtlı kampanya yok" }, ...(campaigns || []).map((c) => ({ value: c.id, label: `${c.name} · ${money(c.cpm)} CPM` }))]}
              />
            </Field>
            <p className="mt-auto text-[12px] leading-relaxed text-muted">
              Kim konuşuyor, hangi açılardan klip istiyorsun? Boş bırakırsan analiz ana temayı çıkarıp bir brief önerir; üretimden önce düzenleyebilirsin. Seçimde brief birincil kriterdir.
            </p>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-bento)] border border-line bg-line md:grid-cols-3 xl:grid-cols-6 animate-fade-up">
        {STEPS.map(([n, t, d]) => (
          <div key={n} className="bg-card px-4 py-3.5">
            <div className="font-mono text-[10.5px] text-dim">{n}</div>
            <div className="mt-1 text-[13.5px]">{t}</div>
            <div className="text-[11.5px] leading-snug text-muted">{d}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 mt-12 flex items-center justify-between">
        <h2 className="font-display text-[22px] font-semibold">Videolar</h2>
        <span className="label">{videos ? `${videos.length} video` : ""}</span>
      </div>
      {!videos ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-[var(--radius-bento)] border border-line bg-card py-14 text-center text-[14px] text-muted">
          Henüz video yüklenmedi.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {videos.map((v, i) => (
            <Link
              key={v.id}
              href={`/uretim/${v.id}`}
              className="group flex gap-4 rounded-[var(--radius-bento)] border border-line bg-card p-4 transition-all duration-300 hover:border-line-2 hover:bg-[#101010] animate-fade-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="h-[84px] w-[132px] shrink-0 overflow-hidden rounded-xl border border-line bg-[#111]">
                {v.poster_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url(v.poster_url)} alt="" className="h-full w-full object-cover opacity-80 transition-all duration-500 group-hover:scale-[1.03] group-hover:opacity-100" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="truncate text-[14px]">{v.filename}</div>
                <div className="mt-1 font-mono text-[11px] text-muted">
                  {tc(v.duration)} · {bytes(v.size)} · {relTime(v.created_at)}
                </div>
                {v.effective_brief && <div className="mt-1 truncate text-[11.5px] text-dim">{v.effective_brief}</div>}
                <div className="mt-auto flex items-center gap-2 pt-2">
                  {v.status === "analyzing" || v.status === "producing" ? (
                    <div className="flex w-full items-center gap-3">
                      <RecDot />
                      <div className="flex-1">
                        <Progress value={v.progress} />
                      </div>
                      <span className="font-mono text-[10.5px] text-muted">{v.stage}</span>
                    </div>
                  ) : (
                    <>
                      <Badge tone={v.status === "error" || v.status === "paused" ? "rec" : "default"}>{STATUS_TR[v.status]}</Badge>
                      {v.analysis && <span className="truncate text-[12px] text-muted">{CATEGORY_TR[v.analysis.primary_category] ?? v.analysis.primary_category}</span>}
                      {v.clip_count > 0 && <span className="ml-auto font-mono text-[11px] text-muted">{v.clips_done}/{v.clip_count}</span>}
                    </>
                  )}
                </div>
              </div>
              <IconChevron size={16} className="self-center text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
