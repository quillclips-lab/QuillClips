"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorBox, Input, PageHeader, Segmented, Select, Skeleton, Toast, Toggle, cx } from "@/components/ui";
import { api, type EditStyle, type FontName, type Options, type Settings } from "@/lib/api";
import { dateTime, EDIT_STYLE_TR, FONT_NAMES } from "@/lib/format";
import { usePoll, useToast } from "@/lib/hooks";

interface ClaudeStatus {
  installed: boolean;
  logged_in: boolean;
  version?: string;
  path?: string;
  auth_method?: string;
  subscription?: string;
  api_key_in_env?: boolean;
  error?: string;
}

interface ClaudeLog {
  id: number;
  ts: number;
  model: string;
  purpose: string;
  duration_ms: number;
  ok: number;
  error: string | null;
  cost_usd: number | null;
  prompt_chars: number;
  preview: string | null;
}

const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"];
const PURPOSE_TR: Record<string, string> = {
  video_analysis: "Video analizi",
  clip_selection: "Klip seçimi",
  visual_review: "Görsel inceleme",
  brief_estimate: "Brief tahmini",
  edit_plan: "Kurgu planı",
  metadata: "Başlık/açıklama",
  title_alternatives: "Alternatif başlık",
  subtitle_translation: "Altyazı çevirisi",
  health_check: "Bağlantı testi",
};

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 py-3 md:grid-cols-[1fr_1.2fr] md:gap-6">
      <div>
        <div className="text-[14px]">{label}</div>
        {hint && <div className="text-[12px] text-muted">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Volume({ value, onChange, disabled, max = 1 }: { value: number; onChange: (v: number) => void; disabled?: boolean; max?: number }) {
  return (
    <div className={cx("flex items-center gap-3", disabled && "opacity-40")}>
      <input type="range" min={0} max={max} step={0.01} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="flex-1" />
      <span className="w-10 font-mono text-[13px]">%{Math.round(value * 100)}</span>
    </div>
  );
}

function ModelField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const custom = !MODELS.includes(value);
  return (
    <div className="space-y-2">
      <Select value={custom ? "__custom" : value} onChange={(v) => onChange(v === "__custom" ? "" : v)} options={[...MODELS.map((m) => ({ value: m, label: m })), { value: "__custom", label: "Özel model adı…" }]} />
      {custom && <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="ör. claude-opus-5-5" />}
    </div>
  );
}

export default function AyarlarPage() {
  const { data: loaded, error, setData: setLoaded } = usePoll<Settings>("/api/settings");
  const { data: options } = usePoll<Options>("/api/options");
  const { data: logs, refresh: refreshLogs } = usePoll<ClaudeLog[]>("/api/claude/logs?limit=40", 10000);
  const [edits, setEdits] = useState<Partial<Settings>>({});
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState<number | null>(null);
  const { toast, show } = useToast();

  useEffect(() => {
    api<ClaudeStatus>("/api/claude/status")
      .then(setStatus)
      .catch((e) => setStatus({ installed: false, logged_in: false, error: e.message }));
  }, []);

  const s: Settings | null = loaded ? { ...loaded, ...edits } : null;
  const styleOptions = Object.entries(options?.subtitle_styles || {}).map(([value, label]) => ({ value, label }));
  const fontOptions = (options?.fonts || FONT_NAMES).map((f) => ({ value: f, label: f }));
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setEdits((e) => ({ ...e, [k]: v }));
  const dirty = Object.keys(edits).length > 0;

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const saved = await api<Settings>("/api/settings", { method: "PUT", json: s });
      setLoaded(saved);
      setEdits({});
      show("Ayarlar kaydedildi");
    } catch (e) {
      show((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="QuillClips / Ayarlar"
        title="Ayarlar"
        right={
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
            Kaydet
          </Button>
        }
      />
      {error && <ErrorBox message={error} />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <Card label="Claude modelleri">
            {!s ? (
              <Skeleton className="h-28" />
            ) : (
              <div className="divide-y divide-line">
                <Row label="Analiz modeli" hint="Video analizi, viral an seçimi, hook metni, kırpma kararları">
                  <ModelField value={s.analysis_model} onChange={(v) => set("analysis_model", v)} />
                </Row>
                <Row label="Metin modeli" hint="Başlık, açıklama, hashtag, platform caption'ları">
                  <ModelField value={s.text_model} onChange={(v) => set("text_model", v)} />
                </Row>
                <Row label="Minimum viral skor" hint="Bunun altındaki anlar listeye alınmaz">
                  <div className="flex items-center gap-3">
                    <input type="range" min={40} max={90} step={5} value={s.min_viral_score} onChange={(e) => set("min_viral_score", Number(e.target.value))} className="flex-1" />
                    <span className="w-8 font-mono text-[13px]">{s.min_viral_score}</span>
                  </div>
                </Row>
                <Row label="Minimum alaka skoru" hint="Brief'e/kampanyaya alakası bunun altındaki anlar elenir">
                  <div className="flex items-center gap-3">
                    <input type="range" min={30} max={90} step={5} value={s.min_relevance_score} onChange={(e) => set("min_relevance_score", Number(e.target.value))} className="flex-1" />
                    <span className="w-8 font-mono text-[13px]">{s.min_relevance_score}</span>
                  </div>
                </Row>
              </div>
            )}
          </Card>

          <Card label="Transkript ve ses">
            {!s ? (
              <Skeleton className="h-40" />
            ) : (
              <div className="divide-y divide-line">
                <Row label="Whisper modeli" hint={`auto: ${options?.cuda ? "GPU bulundu → large-v3-turbo" : "GPU yok → small (CPU, int8)"}`}>
                  <Select value={s.whisper_model} onChange={(v) => set("whisper_model", v)} options={(options?.whisper_models || ["auto"]).map((m) => ({ value: m, label: m }))} />
                </Row>
                <Row label="Cihaz">
                  <Segmented value={s.whisper_device as "auto" | "cpu" | "cuda"} onChange={(v) => set("whisper_device", v)} options={[{ value: "auto", label: "Otomatik" }, { value: "cpu", label: "CPU" }, { value: "cuda", label: "CUDA" }]} />
                </Row>
                <Row label="TTS motoru" hint="Kokoro başarısız olursa Piper'a düşülür">
                  <Segmented value={s.tts_engine as "kokoro" | "piper"} onChange={(v) => set("tts_engine", v)} options={[{ value: "kokoro", label: "Kokoro" }, { value: "piper", label: "Piper" }]} />
                </Row>
                <Row label="Erkek ses">
                  <Select value={s.tts_voice_male} onChange={(v) => set("tts_voice_male", v)} options={(options?.voices.male || []).map((v) => ({ value: v, label: v }))} />
                </Row>
                <Row label="Kadın ses">
                  <Select value={s.tts_voice_female} onChange={(v) => set("tts_voice_female", v)} options={(options?.voices.female || []).map((v) => ({ value: v, label: v }))} />
                </Row>
                <Row label="Varsayılan ses">
                  <Segmented value={s.default_voice_gender} onChange={(v) => set("default_voice_gender", v)} options={[{ value: "male", label: "Erkek" }, { value: "female", label: "Kadın" }]} />
                </Row>
                <Row label="İngilizce olmayan konuşma" hint="Altyazıyı Claude ile İngilizceye çevir (cümle düzeyinde senkron)">
                  <Toggle checked={s.translate_subtitles} onChange={(v) => set("translate_subtitles", v)} label="Altyazıyı çevir" />
                </Row>
              </div>
            )}
          </Card>

          <Card label="Render ve varsayılanlar">
            {!s ? (
              <Skeleton className="h-40" />
            ) : (
              <div className="divide-y divide-line">
                <Row label="Varsayılan altyazı stili">
                  <Select value={s.default_subtitle_style} onChange={(v) => set("default_subtitle_style", v)} options={styleOptions} />
                </Row>
                <Row label="Altyazı fontu">
                  <Select value={s.default_caption_font} onChange={(v) => set("default_caption_font", v as FontName)} options={fontOptions} />
                </Row>
                <Row label="Hook altyazısı" hint="Kapalıysa hook için ayrı stil ve font kullanılır">
                  <Toggle checked={s.default_hook_same_style} onChange={(v) => set("default_hook_same_style", v)} label="Ana altyazıyla aynı stilde" />
                </Row>
                {!s.default_hook_same_style && (
                  <>
                    <Row label="Hook altyazı stili">
                      <Select value={s.default_hook_subtitle_style} onChange={(v) => set("default_hook_subtitle_style", v)} options={styleOptions} />
                    </Row>
                    <Row label="Hook fontu">
                      <Select value={s.default_hook_font} onChange={(v) => set("default_hook_font", v as FontName)} options={fontOptions} />
                    </Row>
                  </>
                )}
                <Row label="Kurgu stili" hint="Kesim, zoom, yazı ve SFX yoğunluğu">
                  <Segmented value={s.default_edit_style} onChange={(v) => set("default_edit_style", v)} options={(["minimal", "balanced", "aggressive"] as EditStyle[]).map((v) => ({ value: v, label: EDIT_STYLE_TR[v] }))} />
                </Row>
                <Row label="Varsayılan klip süresi">
                  <Segmented value={s.default_duration} onChange={(v) => set("default_duration", v)} options={[{ value: "15-30", label: "15-30" }, { value: "30-60", label: "30-60" }, { value: "60-90", label: "60-90" }, { value: "auto", label: "Oto" }]} />
                </Row>
                <Row label="Varsayılan reframe">
                  <Segmented value={s.default_reframe} onChange={(v) => set("default_reframe", v)} options={[{ value: "face", label: "Yüz" }, { value: "center", label: "Ortala" }, { value: "blur", label: "Bulanık" }]} />
                </Row>
                <Row label="Çözünürlük">
                  <Select
                    value={`${s.render_width}x${s.render_height}`}
                    onChange={(v) => {
                      const [w, h] = v.split("x").map(Number);
                      setEdits((e) => ({ ...e, render_width: w, render_height: h }));
                    }}
                    options={[
                      { value: "1080x1920", label: "1080 × 1920 (önerilen)" },
                      { value: "720x1280", label: "720 × 1280 (hızlı)" },
                      { value: "1440x2560", label: "1440 × 2560" },
                    ]}
                  />
                </Row>
                <Row label="Video bitrate">
                  <Select value={s.video_bitrate} onChange={(v) => set("video_bitrate", v)} options={["4M", "6M", "8M", "12M", "16M"].map((b) => ({ value: b, label: `${b}bps` }))} />
                </Row>
                <Row label="Encoder hızı" hint="Yavaş = daha iyi sıkıştırma">
                  <Select value={s.x264_preset} onChange={(v) => set("x264_preset", v)} options={["veryfast", "faster", "fast", "medium", "slow"].map((b) => ({ value: b, label: b }))} />
                </Row>
                <Row label="Remotion eşzamanlılık" hint="Aynı anda render edilen kare sayısı (CPU çekirdeğine göre)">
                  <Select value={String(s.remotion_concurrency)} onChange={(v) => set("remotion_concurrency", Number(v))} options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }))} />
                </Row>
                <Row label="Remotion GL" hint="3D yazı için WebGL arka ucu">
                  <Select value={s.remotion_gl} onChange={(v) => set("remotion_gl", v)} options={["angle", "swangle", "swiftshader", "egl"].map((g) => ({ value: g, label: g }))} />
                </Row>
                <Row label="Çıktı klasörü">
                  <Input value={s.output_dir} onChange={(e) => set("output_dir", e.target.value)} className="font-mono" />
                </Row>
              </div>
            )}
          </Card>

          <Card label="Ses efektleri ve müzik">
            {!s ? (
              <Skeleton className="h-32" />
            ) : (
              <div className="divide-y divide-line">
                <Row label="SFX" hint="Kurgu planındaki whoosh, pop, hit… efektleri">
                  <Toggle checked={s.sfx_enabled} onChange={(v) => set("sfx_enabled", v)} label="Efektleri ekle" />
                </Row>
                <Row label="SFX seviyesi">
                  <Volume value={s.sfx_volume} onChange={(v) => set("sfx_volume", v)} disabled={!s.sfx_enabled} />
                </Row>
                <Row label="Arka plan müziği" hint="assets/music klasörüne koyduğun dosyalar; konuşmada otomatik kısılır">
                  <Toggle checked={s.music_enabled} onChange={(v) => set("music_enabled", v)} label="Müzik ekle" />
                </Row>
                <Row label="Müzik seviyesi">
                  <Volume value={s.music_volume} onChange={(v) => set("music_volume", v)} disabled={!s.music_enabled} max={0.4} />
                </Row>
                {options?.sfx && (
                  <div className="py-3">
                    <div className="label mb-2">Kütüphane</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(options.sfx).map(([k, v]) => (
                        <Badge key={k} tone={v.count ? "default" : "rec"}>
                          {k} · {v.count}
                          {v.user ? " · senin" : ""}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-[12px] text-muted">
                      Kendi dosyalarını <span className="font-mono">assets/sfx/&lt;tür&gt;/</span> ve <span className="font-mono">assets/music/</span> altına koy; otomatik algılanır.
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-5">
          <Card
            label="Claude CLI"
            right={
              <Button
                size="sm"
                variant="outline"
                loading={testing}
                onClick={async () => {
                  setTesting(true);
                  setTestResult(null);
                  try {
                    const r = await api<{ ok: boolean; reply?: string; ms?: number; error?: string }>("/api/claude/test", { method: "POST" });
                    setTestResult(r.ok ? `Yanıt alındı: "${r.reply}" (${((r.ms || 0) / 1000).toFixed(1)} sn)` : r.error || "Başarısız");
                    refreshLogs();
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                Bağlantıyı test et
              </Button>
            }
          >
            {!status ? (
              <Skeleton className="h-24" />
            ) : (
              <div className="space-y-2.5 text-[13.5px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Kurulu</span>
                  <Badge tone={status.installed ? "solid" : "rec"}>{status.installed ? "Evet" : "Hayır"}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Giriş yapılmış</span>
                  <Badge tone={status.logged_in ? "solid" : "rec"}>{status.logged_in ? "Evet" : "Hayır"}</Badge>
                </div>
                {status.version && (
                  <div className="flex justify-between">
                    <span className="text-muted">Sürüm</span>
                    <span className="font-mono text-[12px]">{status.version}</span>
                  </div>
                )}
                {status.auth_method && (
                  <div className="flex justify-between">
                    <span className="text-muted">Kimlik doğrulama</span>
                    <span className="font-mono text-[12px]">
                      {status.auth_method}
                      {status.subscription ? ` · ${status.subscription}` : ""}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted">API key</span>
                  <span className="font-mono text-[12px]">{status.api_key_in_env ? "ortamda var, çağrılarda siliniyor" : "kullanılmıyor"}</span>
                </div>
                {status.path && <div className="truncate font-mono text-[11px] text-dim">{status.path}</div>}
                {status.error && <ErrorBox message={status.error} />}
                {!status.logged_in && status.installed && <p className="text-[12.5px] text-muted">Terminalde `claude` komutunu çalıştırıp aboneliğinle giriş yap.</p>}
                {testResult && <div className="rounded-xl border border-line bg-[#0a0a0a] px-3 py-2 text-[12.5px]">{testResult}</div>}
                {s && (
                  <div className="pt-2">
                    <div className="label mb-1.5">Özel claude yolu (opsiyonel)</div>
                    <Input value={s.claude_path} onChange={(e) => set("claude_path", e.target.value)} placeholder="PATH'teki claude kullanılır" className="font-mono" />
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card label="Son Claude çağrıları" right={<Button size="sm" variant="ghost" onClick={refreshLogs}>Yenile</Button>}>
            {!logs ? (
              <Skeleton className="h-48" />
            ) : logs.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted">Henüz çağrı yok.</p>
            ) : (
              <ul className="max-h-[560px] divide-y divide-line overflow-y-auto pr-1">
                {logs.map((l) => (
                  <li key={l.id} className="py-2.5">
                    <button type="button" className="w-full text-left" onClick={() => setOpenLog(openLog === l.id ? null : l.id)}>
                      <div className="flex items-center gap-2">
                        <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", l.ok ? "bg-[#3ddc84]" : "bg-rec")} />
                        <span className="text-[13px]">{PURPOSE_TR[l.purpose] ?? l.purpose}</span>
                        <span className="ml-auto font-mono text-[11px] text-muted">{(l.duration_ms / 1000).toFixed(1)} sn</span>
                      </div>
                      <div className="mt-0.5 flex gap-2 pl-3.5 font-mono text-[10.5px] text-dim">
                        <span>{l.model}</span>
                        <span>·</span>
                        <span>{dateTime(l.ts)}</span>
                        <span>·</span>
                        <span>{(l.prompt_chars / 1000).toFixed(1)}k karakter</span>
                      </div>
                    </button>
                    {openLog === l.id && (
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-[#0a0a0a] p-2.5 font-mono text-[11px] text-muted animate-fade-up">
                        {l.error ? `HATA: ${l.error}\n\n` : ""}
                        {l.preview}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}
