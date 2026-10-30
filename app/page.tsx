"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bars, ScoreRing, Sparkline } from "@/components/charts";
import { IconChevron, IconLink, PlatformIcon } from "@/components/icons";
import { Button, Card, ErrorBox, PageHeader, Progress, RecDot, Skeleton } from "@/components/ui";
import { api, url, type Dashboard, type PlatformStats } from "@/lib/api";
import { compact, money, relTime, tc } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { PROVIDERS } from "@/lib/platforms";

const DAY = ["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"];

function lastSevenLabels() {
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) out.push(DAY[new Date(Date.now() - i * 86400000).getDay()]);
  return out;
}

function PlatformCard({ stats, delay }: { stats: PlatformStats | null; delay: number }) {
  return (
    <Card delay={delay} className="flex min-h-[260px] flex-col">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {stats ? <PlatformIcon platform={stats.platform} size={20} /> : <Skeleton className="h-5 w-5" />}
          <span className="text-[15px]">{stats?.label ?? "…"}</span>
        </div>
        <span className="label">Hesap bağlanmadı</span>
      </div>
      {stats ? (
        <div className="flex flex-1 flex-col opacity-55">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label mb-1">Toplam izlenme</div>
              <div className="font-display text-[28px] leading-none">{compact(stats.total_views)}</div>
            </div>
            <div>
              <div className="label mb-1">Takipçi</div>
              <div className="font-display text-[28px] leading-none">{compact(stats.followers)}</div>
            </div>
          </div>
          <div className="mt-4">
            <div className="label mb-1">Son 7 gün</div>
            <Sparkline data={stats.last7} height={54} muted />
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
            <div className="min-w-0">
              <div className="label">En iyi klip</div>
              <div className="truncate text-[13px] text-muted">{stats.best_clip?.title}</div>
            </div>
            <Button size="sm" variant="outline" disabled title="Yakında">
              <IconLink size={13} /> Bağla
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      )}
    </Card>
  );
}

/** Per-campaign estimated earnings: views × CPM / 1000. Views stay empty until an analytics provider is connected. */
function EarningsCard({ data }: { data: Dashboard | null }) {
  const e = data?.earnings;
  return (
    <Card
      label="Kampanya kazancı (tahmini)"
      className="md:col-span-6 xl:col-span-12"
      delay={390}
      right={
        <span className="font-mono text-[10.5px] text-dim">
          {e?.analytics_connected ? "izlenme × CPM / 1000" : "Analitik bağlanınca hesaplanır"}
        </span>
      }
    >
      {!e ? (
        <Skeleton className="h-24 w-full" />
      ) : e.campaigns.length === 0 ? (
        <div className="py-6 text-center text-[14px] text-muted">
          Henüz kampanya yok.{" "}
          <Link href="/kampanyalar" className="text-fg underline-offset-4 hover:underline">
            Kampanya ekle
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {e.campaigns.map((c) => (
            <Link
              key={c.id}
              href={`/envanter?campaign=${c.id}`}
              className="group rounded-xl border border-line bg-[#0b0b0b] p-4 transition-colors hover:border-line-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[14px]">{c.name}</span>
                <span className="flex shrink-0 gap-1 text-muted">
                  {c.platforms.map((p) => (
                    <PlatformIcon key={p} platform={p} size={13} />
                  ))}
                </span>
              </div>
              <div className="mt-3 font-display text-[30px] leading-none">{c.estimated == null ? "—" : money(c.estimated)}</div>
              <div className="mt-2 font-mono text-[11px] text-muted">
                {money(c.cpm)} CPM · {c.clips_done}/{c.clips} klip · {c.shared} paylaşıldı · {c.views == null ? "izlenme —" : `${compact(c.views)} izlenme`}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function PanelPage() {
  const { data, error, refresh } = usePoll<Dashboard>("/api/dashboard", 5000);
  const [platforms, setPlatforms] = useState<(PlatformStats | null)[]>([null, null, null]);

  useEffect(() => {
    api<PlatformStats[]>("/api/platforms")
      .then((all) => Promise.all(PROVIDERS.map((p) => p.fetchStats(all))))
      .then(setPlatforms)
      .catch(() => {});
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="QuillClips / Panel"
        title={<span className="chrome-text">Stüdyo özeti</span>}
        right={
          <Link href="/uretim">
            <Button variant="primary">Yeni video işle</Button>
          </Link>
        }
      />
      {error && (
        <div className="mb-6">
          <ErrorBox message={error} onRetry={refresh} />
        </div>
      )}
      {data && data.paused_jobs > 0 && (
        <div className="mb-6">
          <ErrorBox
            message={`${data.paused_jobs} iş Claude kullanım limiti nedeniyle duraklatıldı. Limit sıfırlandığında devam ettirebilirsiniz.`}
            retryLabel="Devam et"
            onRetry={async () => {
              await api("/api/jobs/resume", { method: "POST" });
              refresh();
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
        {/* real data */}
        <Card label="Envanter" className="md:col-span-2 xl:col-span-3" delay={0}>
          {data ? (
            <>
              <div className="font-display text-[64px] font-semibold leading-none">{data.clips_total}</div>
              <div className="mt-2 text-[13px] text-muted">hazır klip</div>
              {data.rendering > 0 && (
                <div className="mt-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                  <RecDot /> {data.rendering} render sırada
                </div>
              )}
            </>
          ) : (
            <Skeleton className="h-20 w-24" />
          )}
        </Card>

        <Card label="Bu hafta üretilen" className="md:col-span-4 xl:col-span-5" delay={60}>
          {data ? (
            <div className="flex items-end gap-6">
              <div>
                <div className="font-display text-[64px] font-semibold leading-none">{data.clips_this_week}</div>
                <div className="mt-2 text-[13px] text-muted">son 7 gün</div>
              </div>
              <div className="flex-1">
                <Bars data={data.daily} labels={lastSevenLabels()} />
              </div>
            </div>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </Card>

        <Card label="Paylaşılmayı bekleyen" className="md:col-span-6 xl:col-span-4" delay={120}>
          {data ? (
            <div className="flex h-full flex-col">
              <div className="font-display text-[64px] font-semibold leading-none">{data.pending_share}</div>
              <div className="mt-2 text-[13px] text-muted">hiçbir platformda işaretlenmemiş klip</div>
              <Link href="/envanter?shared=none" className="mt-4 inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-fg">
                Envanterde gör <IconChevron size={14} />
              </Link>
            </div>
          ) : (
            <Skeleton className="h-20 w-24" />
          )}
        </Card>

        {/* platforms (placeholder providers) */}
        {platforms.map((p, i) => (
          <div key={PROVIDERS[i].id} className="md:col-span-3 xl:col-span-4">
            <PlatformCard stats={p} delay={180 + i * 60} />
          </div>
        ))}

        <Card label="Son işlenen videolar" className="md:col-span-6 xl:col-span-8" delay={360}>
          {!data ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : data.recent_videos.length === 0 ? (
            <div className="py-8 text-center text-[14px] text-muted">
              Henüz video yok.{" "}
              <Link href="/uretim" className="text-fg underline-offset-4 hover:underline">
                İlk videonu yükle
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data.recent_videos.map((v) => (
                <li key={v.id}>
                  <Link href={`/uretim/${v.id}`} className="group flex items-center gap-4 py-3">
                    <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-[#111]">
                      {v.poster_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url(v.poster_url)} alt="" className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px]">{v.filename}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted">
                        {tc(v.duration)} · {v.clips_done}/{v.clip_count} klip · {relTime(v.created_at)}
                      </div>
                      {(v.status === "analyzing" || v.status === "producing") && (
                        <div className="mt-2 max-w-[260px]">
                          <Progress value={v.progress} />
                        </div>
                      )}
                    </div>
                    <span className="label hidden sm:block">{v.stage || v.status}</span>
                    <IconChevron size={16} className="text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card label="En yüksek skor" className="md:col-span-6 xl:col-span-4" delay={420}>
          {!data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.top_clip ? (
            <Link href={`/envanter?clip=${data.top_clip.id}`} className="group flex gap-4">
              <div className="aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-xl border border-line bg-[#111]">
                {data.top_clip.thumb_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url(data.top_clip.thumb_url)} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <ScoreRing score={data.top_clip.score} size={46} />
                <div className="mt-3 line-clamp-3 text-[14px] leading-snug">
                  {data.top_clip.metadata.youtube_title || data.top_clip.summary}
                </div>
                <div className="mt-2 font-mono text-[11px] text-muted">{data.top_clip.video_filename}</div>
              </div>
            </Link>
          ) : (
            <div className="py-8 text-center text-[14px] text-muted">Henüz klip üretilmedi.</div>
          )}
        </Card>

        <EarningsCard data={data} />
      </div>
    </>
  );
}
