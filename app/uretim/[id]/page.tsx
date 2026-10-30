"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import ClipCard from "@/components/ClipCard";
import OptionsPanel from "@/components/OptionsPanel";
import { IconCheck, IconRefresh, IconTrash, PlatformIcon } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Input, Progress, RecDot, Select, Skeleton, Textarea, Toast, cx } from "@/components/ui";
import { api, type Campaign, type Clip, type Options, type Platform, type ProduceOptions, type Settings, type Streamer, type Video } from "@/lib/api";
import { BRIEF_PLACEHOLDER, CATEGORY_TR, PLATFORM_LABEL, bytes, tc } from "@/lib/format";
import { usePoll, useToast } from "@/lib/hooks";

const ANALYZE_STAGES = ["Ses çıkarılıyor", "Transkript", "Anlar taranıyor", "Claude analizi"];
const PRODUCE_STAGES = ["Brief'e uygun anlar seçiliyor", "Görsel inceleme", "Başlık ve açıklamalar", "Render kuyruğunda"];

function Stages({ stages, current, progress, paused }: { stages: string[]; current: string | null; progress: number; paused?: boolean }) {
  const idx = Math.max(0, stages.indexOf(current || ""));
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s} className={cx("flex items-center gap-3 transition-opacity duration-500", !done && !active && "opacity-35")}>
            <span
              className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                done ? "border-fg bg-fg text-ink" : active ? "border-fg" : "border-line-2",
              )}
            >
              {done ? <IconCheck size={12} /> : active ? paused ? <span className="h-1.5 w-1.5 rounded-full bg-rec" /> : <RecDot /> : null}
            </span>
            <span className="text-[14px]">{s}</span>
            {active && <span className="ml-auto font-mono text-[11px] text-muted">{Math.round(progress * 100)}%</span>}
          </div>
        );
      })}
      <div className="pt-1">
        <Progress value={progress} />
      </div>
    </div>
  );
}

function defaultOptions(s: Settings | null, v: Video | null): ProduceOptions {
  const saved = (v?.options || {}) as Partial<ProduceOptions>;
  const person: Streamer = v?.streamer || { platform: "youtube" as Platform, username: "" };
  const estimate = v?.analysis?.brief_estimate?.count ?? v?.analysis?.estimated_clip_count;
  return {
    hook: true,
    voice_gender: s?.default_voice_gender || "male",
    voice: undefined,
    subtitles: true,
    subtitle_style: s?.default_subtitle_style || "yellow",
    caption_font: s?.default_caption_font || "Montserrat Black",
    hook_same_style: s?.default_hook_same_style ?? true,
    hook_subtitle_style: s?.default_hook_subtitle_style || "outline",
    hook_font: s?.default_hook_font || "Anton",
    edit_style: s?.default_edit_style || "balanced",
    instagram_on: !!person.instagram,
    instagram: person.instagram || "",
    duration: s?.default_duration || "auto",
    max_clips: Math.min(20, Math.max(1, estimate || s?.default_max_clips || 8)),
    reframe: s?.default_reframe || "face",
    ...saved,
    campaign_id: v?.campaign_id ?? null,
    person: { name: person.name, platform: person.platform || "youtube", username: person.username || "", instagram: person.instagram, guessed: person.guessed },
  };
}

export default function VideoPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[420px] w-full" />}>
      <VideoWorkspace />
    </Suspense>
  );
}

function VideoWorkspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: video, error, refresh, setData } = usePoll<Video>(`/api/videos/${id}`, 2000);
  const { data: settings } = usePoll<Settings>("/api/settings");
  const { data: options } = usePoll<Options>("/api/options");
  const { data: campaigns } = usePoll<Campaign[]>("/api/campaigns");
  const [optsState, setOpts] = useState<ProduceOptions | null>(null);
  const [briefState, setBrief] = useState<string | null>(null);
  const [excludeState, setExclude] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [editCreator, setEditCreator] = useState(false);
  const { toast, show } = useToast();

  // options start from settings + analysis guesses until the user edits them
  const opts = optsState ?? (video?.analysis && settings ? defaultOptions(settings, video) : null);
  const a = video?.analysis ?? null;
  // the brief box is prefilled with the user's brief, else the system's suggestion (editable)
  const brief = briefState ?? (video?.brief || a?.suggested_brief || "");
  const exclude = excludeState ?? (video?.exclude || "");

  const clips = useMemo(() => video?.clips ?? [], [video]);
  const updateClip = (c: Clip) => setData((v) => (v ? { ...v, clips: (v.clips || []).map((x) => (x.id === c.id ? c : x)) } : v));

  if (error && !video) {
    return <ErrorBox message={error} onRetry={refresh} />;
  }
  if (!video) {
    return (
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-10 w-2/3 xl:col-span-12" />
        <Skeleton className="h-[420px] xl:col-span-8" />
        <Skeleton className="h-[420px] xl:col-span-4" />
      </div>
    );
  }

  const analyzing = video.status === "analyzing" || (video.job?.kind === "analyze" && video.job.status !== "done");
  const producing = video.status === "producing";
  const failed = video.status === "error" || video.status === "paused";
  const est = a?.brief_estimate;
  const estFresh = !!est && est.brief.trim() === brief.trim() && (est.exclude || "").trim() === exclude.trim();
  const usingSuggestion = !video.brief && !briefState && !!a?.suggested_brief;

  async function produce() {
    if (!opts) return;
    setBusy(true);
    try {
      const v = await api<Video>(`/api/videos/${id}/produce`, {
        method: "POST",
        json: { options: { ...opts, brief: brief.trim(), exclude: exclude.trim() } },
      });
      setData(v);
      show("Üretim kuyruğa alındı");
    } catch (e) {
      show((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function reestimate() {
    if (!brief.trim()) return;
    setEstimating(true);
    try {
      const v = await api<Video>(`/api/videos/${id}/estimate`, { method: "POST", json: { brief: brief.trim(), exclude: exclude.trim() } });
      setData(v);
      const n = v.analysis?.brief_estimate?.count;
      if (n != null && opts) setOpts({ ...opts, max_clips: Math.min(20, Math.max(1, n)) });
      show("Tahmin brief'e göre güncellendi");
    } catch (e) {
      show((e as Error).message, "err");
    } finally {
      setEstimating(false);
    }
  }

  async function retry() {
    try {
      setData(await api<Video>(`/api/videos/${id}/retry`, { method: "POST" }));
    } catch (e) {
      show((e as Error).message, "err");
    }
  }

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div className="min-w-0">
          <div className="label mb-2">
            <Link href="/uretim" className="hover:text-fg">
              Üretim
            </Link>{" "}
            / {video.id}
          </div>
          <h1 className="truncate font-display text-[26px] font-semibold leading-tight md:text-[34px]">{video.filename}</h1>
          <div className="mt-2 font-mono text-[11.5px] text-muted">
            {tc(video.duration)} · {video.width}×{video.height} · {Math.round(video.fps)} fps · {bytes(video.size)}
          </div>
        </div>
        <div className="flex gap-2">
          {a && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                setData(await api<Video>(`/api/videos/${id}/reanalyze`, { method: "POST" }));
                setOpts(null);
              }}
            >
              Yeniden analiz
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              if (!confirm("Video ve tüm klipleri silinsin mi?")) return;
              await api(`/api/videos/${id}`, { method: "DELETE" });
              router.push("/uretim");
            }}
          >
            <IconTrash size={14} /> Sil
          </Button>
        </div>
      </div>

      {failed && video.error && (
        <div className="mb-5">
          <ErrorBox message={video.error} onRetry={retry} retryLabel={video.status === "paused" ? "Devam et" : "Tekrar dene"} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          {analyzing || !a ? (
            <Card label={<span className="flex items-center gap-2">{!failed && <RecDot />} Analiz ediliyor…</span>}>
              <div className="grid gap-8 md:grid-cols-2">
                <Stages stages={ANALYZE_STAGES} current={video.stage} progress={video.progress} paused={failed} />
                <div className="space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-5/6" />
                  <Skeleton className="mt-6 h-16 w-full" />
                </div>
              </div>
              {video.brief && (
                <div className="mt-6 rounded-xl border border-line bg-[#0a0a0a] px-4 py-3 text-[13px]">
                  <span className="label mr-2">Brief</span>
                  <span className="text-muted">{video.brief}</span>
                </div>
              )}
              <p className="mt-6 text-[12.5px] text-muted">
                Sayfayı kapatabilirsin; işlem worker&apos;da devam eder ve ilerleme kaybolmaz. Analiz bitince brief&apos;i düzenleyip üretime geçebilirsin.
              </p>
            </Card>
          ) : (
            <>
              <Card
                label="Brief"
                delay={0}
                right={usingSuggestion ? <Badge>Sistem önerisi · düzenleyebilirsin</Badge> : video.brief ? <Badge tone="solid">Senin brief&apos;in</Badge> : null}
              >
                <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
                  <div className="space-y-3">
                    <Textarea rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={BRIEF_PLACEHOLDER} />
                    <Input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder={a.suggested_exclude ? `Hariç tut — öneri: ${a.suggested_exclude}` : "Hariç tut (ör. müzik, rapçiler, kişisel dedikodu)"} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" loading={estimating} disabled={!brief.trim() || estFresh} onClick={reestimate}>
                        <IconRefresh size={13} /> Tahmini yeniden hesapla
                      </Button>
                      {a.suggested_exclude && !exclude && (
                        <button type="button" onClick={() => setExclude(a.suggested_exclude || "")} className="text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline">
                          Önerilen hariç tutmaları ekle
                        </button>
                      )}
                    </div>
                    <p className="text-[12px] leading-snug text-dim">
                      Brief ve kampanya kuralları seçimin birincil kriteri: alaka skoru eşiğin ({settings?.min_relevance_score ?? 60}) altındaki anlar, viral olsalar bile elenir. Hariç tutulan konulara dokunan klip seçilmez.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-line bg-[#0a0a0a] p-4">
                      <div className="label mb-1">Brief&apos;e uygun klip</div>
                      <div className="flex items-end gap-2">
                        <span className={cx("font-display text-[52px] font-semibold leading-none", !estFresh && "text-dim")}>{est ? est.count : a.estimated_clip_count}</span>
                        <span className="mb-1 text-[12px] text-muted">/ {a.estimated_clip_count} genel</span>
                      </div>
                      <p className="mt-2 text-[12px] leading-snug text-muted">
                        {!est ? a.estimate_reason : estFresh ? est.reason : "Brief değişti — tahmini yeniden hesapla."}
                      </p>
                      {estFresh && est?.dropped_off_brief ? <p className="mt-1 text-[11.5px] text-dim">{est.dropped_off_brief} viral ama brief dışı an elendi.</p> : null}
                    </div>
                    {(a.main_theme || a.person_expertise) && (
                      <div className="space-y-1.5 text-[12.5px]">
                        {a.main_theme && (
                          <div>
                            <span className="label mr-1.5">Ana tema</span>
                            <span className="text-muted">{a.main_theme}</span>
                          </div>
                        )}
                        {a.person_expertise && (
                          <div>
                            <span className="label mr-1.5">Kişi</span>
                            <span className="text-muted">{a.person_expertise}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
              <Card label="Video özeti" delay={40}>
                <p className="font-display text-[19px] font-medium leading-snug md:text-[21px]">{a.summary}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {a.topics?.map((t) => (
                    <span key={t} className="rounded-full border border-line-2 px-2.5 py-0.5 text-[12px] text-muted">
                      {t}
                    </span>
                  ))}
                </div>
              </Card>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Card label="Kategori" delay={60}>
                  <div className="text-[17px]">{CATEGORY_TR[a.primary_category] ?? a.primary_category}</div>
                  <div className="font-mono text-[11px] text-muted">{a.primary_category}</div>
                  {a.secondary_category && (
                    <div className="mt-3 border-t border-line pt-3">
                      <div className="label mb-1">İkincil</div>
                      <div className="text-[14px] text-muted">{CATEGORY_TR[a.secondary_category] ?? a.secondary_category}</div>
                    </div>
                  )}
                </Card>
                <Card label="Sinyaller" delay={100}>
                  <div className="space-y-1.5 font-mono text-[12px]">
                    <div className="flex justify-between"><span className="text-muted">Kelime</span>{a.word_count?.toLocaleString("tr-TR") ?? "—"}</div>
                    <div className="flex justify-between"><span className="text-muted">Enerji tepesi</span>{a.signal_counts?.energy_peaks ?? "—"}</div>
                    <div className="flex justify-between"><span className="text-muted">Sahne değişimi</span>{a.signal_counts?.scene_changes ?? "—"}</div>
                    <div className="flex justify-between"><span className="text-muted">Dil</span>{a.language}</div>
                    <div className="flex justify-between"><span className="text-muted">Tür</span>{a.content_type}</div>
                  </div>
                </Card>
              </div>
              <Card
                label="Konuşmacılar ve kişi"
                delay={140}
                right={
                  <Button size="sm" variant="ghost" onClick={() => setEditCreator((x) => !x)}>
                    {editCreator ? "Kapat" : "Düzenle"}
                  </Button>
                }
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <ul className="space-y-2.5">
                    {a.speakers?.map((s, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-2 font-mono text-[11px] text-muted">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="text-[14px]">
                            {s.name || s.label} <span className="text-muted">· {s.role}</span>
                          </div>
                          <div className="text-[12px] leading-snug text-dim">{s.evidence}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="rounded-2xl border border-line bg-[#0a0a0a] p-4">
                    <div className="label mb-3">İçerik üreticisi tahmini</div>
                    {editCreator && opts?.person ? (
                      <CreatorEditor
                        value={opts.person}
                        onSave={async (s) => {
                          setOpts({ ...opts, person: { ...s, guessed: false } });
                          setData(await api<Video>(`/api/videos/${id}`, { method: "PATCH", json: { streamer: s } }));
                          setEditCreator(false);
                          show("Kişi bilgisi kaydedildi");
                        }}
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2.5">
                          <PlatformIcon platform={video.streamer?.platform || a.creator.platform} size={20} />
                          <div>
                            <div className="text-[15px]">{video.streamer?.name || a.creator.name || "Bilinmiyor"}</div>
                            <div className="font-mono text-[12px] text-muted">
                              {PLATFORM_LABEL[video.streamer?.platform || a.creator.platform]} · @{video.streamer?.username || a.creator.username || "?"}
                            </div>
                          </div>
                          <Badge>{Math.round((a.creator.confidence || 0) * 100)}% güven</Badge>
                        </div>
                        <p className="mt-3 text-[12px] leading-snug text-dim">{a.creator.evidence}</p>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>

        <div className="xl:col-span-4">
          <div className="xl:sticky xl:top-8">
            <Card label="Seçenekler" delay={80}>
              {opts && options ? (
                <>
                  <OptionsPanel value={opts} onChange={setOpts} options={options} campaigns={campaigns || []} />
                  <Button variant="primary" size="lg" className="mt-6 w-full" loading={busy} disabled={producing || analyzing} onClick={produce}>
                    {producing ? "Üretiliyor…" : clips.length ? "Yeni klipler üret" : "Üret"}
                  </Button>
                  {clips.length > 0 && !producing && (
                    <label className="mt-3 flex items-center justify-center gap-2 text-[12px] text-muted">
                      <input type="checkbox" checked={!!opts.fresh} onChange={(e) => setOpts({ ...opts, fresh: e.target.checked })} className="accent-white" />
                      Önbelleği yok say, Opus seçimi baştan yapsın
                    </label>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                  <p className="text-[12.5px] text-muted">Seçenekler analiz bitince açılır.</p>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      {(producing || (video.job?.kind === "produce" && video.job.status === "paused")) && (
        <Card label={<span className="flex items-center gap-2"><RecDot /> Klipler hazırlanıyor</span>} className="mt-4">
          <div className="max-w-xl">
            <Stages stages={PRODUCE_STAGES} current={video.stage} progress={video.progress} paused={failed} />
          </div>
        </Card>
      )}

      {clips.length > 0 && (
        <section className="mt-12">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="font-display text-[24px] font-semibold">Klipler</h2>
            <span className="label">
              {video.clips_done}/{clips.length} hazır
            </span>
          </div>
          <div className="space-y-4">
            {clips.map((c, i) => (
              <ClipCard key={c.id} clip={c} onChange={updateClip} delay={i * 50} />
            ))}
          </div>
        </section>
      )}
      <Toast toast={toast} />
    </>
  );
}

function CreatorEditor({ value, onSave }: { value: Streamer; onSave: (s: Streamer) => void }) {
  const [s, setS] = useState(value);
  return (
    <div className="space-y-2">
      <Input value={s.name || ""} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Ad" />
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <Select
          value={s.platform}
          onChange={(p) => setS({ ...s, platform: p })}
          options={(["kick", "twitch", "youtube", "tiktok", "instagram", "x", "podcast"] as Platform[]).map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))}
        />
        <Input prefix="@" value={s.username} onChange={(e) => setS({ ...s, username: e.target.value.replace(/^@/, "") })} placeholder="kullanıcı adı" />
      </div>
      <Button size="sm" variant="primary" onClick={() => onSave(s)}>
        Kaydet
      </Button>
    </div>
  );
}
