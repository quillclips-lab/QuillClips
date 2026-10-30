"use client";

import { useRef, type CSSProperties } from "react";
import { url, type Campaign, type EditStyle, type FontName, type Options, type Platform, type ProduceOptions } from "@/lib/api";
import { FONT_NAMES, money, PLATFORM_LABEL } from "@/lib/format";
import { IconPlay, PlatformIcon } from "./icons";
import { cx, Input, Segmented, Select, Toggle } from "./ui";

const PLATFORMS: Platform[] = ["kick", "twitch", "youtube", "tiktok", "instagram", "x", "podcast"];

const EDIT_HINT: Record<EditStyle, string> = {
  minimal: "Temiz kurgu: sadece uzun sessizlikler kesilir, nadir zoom, efekt yok denecek kadar az.",
  balanced: "Her 2-3 sn'de bir görsel değişim: jump cut, punch-in, anahtar kelime pop-up'ları, ölçülü SFX.",
  aggressive: "MrBeast/Hormozi temposu: her ölü an kesilir, sık zoom, pop-up, geçiş ve ses efekti.",
};

// Mirrors remotion/styles.ts so the preview looks like the render.
const LOOK: Record<string, { color: string; active: string; stroke: number; upper: boolean; box: boolean; dim: number }> = {
  classic: { color: "#fff", active: "#fff", stroke: 3, upper: false, box: false, dim: 0.72 },
  yellow: { color: "#fff", active: "#FFD400", stroke: 3.5, upper: true, box: false, dim: 1 },
  minimal: { color: "#fff", active: "#fff", stroke: 0, upper: false, box: true, dim: 0.55 },
  outline: { color: "#fff", active: "#3CFF6B", stroke: 4.5, upper: true, box: false, dim: 1 },
};
const FONT_SIZE: Record<string, number> = { Anton: 1.18, "Bebas Neue": 1.36, "Montserrat Black": 1, "Archivo Black": 0.98 };

export function CaptionSample({ styleKey, font, words, active, size = 22 }: { styleKey: string; font: string; words: string[]; active: number; size?: number }) {
  const look = LOOK[styleKey] ?? LOOK.yellow;
  const css: CSSProperties = {
    fontFamily: `'${font}', sans-serif`,
    fontSize: Math.round(size * (FONT_SIZE[font] ?? 1)),
    lineHeight: 1.05,
    textTransform: look.upper ? "uppercase" : "none",
    WebkitTextStroke: look.stroke ? `${look.stroke}px #000` : undefined,
    paintOrder: "stroke fill",
    letterSpacing: font === "Bebas Neue" ? 0.5 : 0,
  };
  return (
    <span className={cx("inline-flex flex-wrap justify-center gap-x-[0.3em]", look.box && "rounded-md bg-black/55 px-2 py-0.5")} style={css}>
      {words.map((w, i) => (
        <span key={i} style={{ color: i === active ? look.active : look.color, opacity: i === active ? 1 : look.dim, transform: i === active && !look.box ? "scale(1.08)" : undefined, display: "inline-block" }}>
          {w}
        </span>
      ))}
    </span>
  );
}

function FontPicker({ value, onChange, styleKey }: { value: FontName; onChange: (f: FontName) => void; styleKey: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {FONT_NAMES.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onChange(f)}
          className={cx("flex h-14 flex-col items-center justify-center rounded-xl border transition-all", value === f ? "border-fg bg-[#141414]" : "border-line-2 hover:border-[#333]")}
        >
          <CaptionSample styleKey={styleKey} font={f} words={["Aa", "123"]} active={1} size={17} />
          <span className="mt-1 text-[10.5px] text-muted">{f}</span>
        </button>
      ))}
    </div>
  );
}

function StyleGrid({ value, onChange, styles, font }: { value: string; onChange: (k: string) => void; styles: Record<string, string>; font: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(styles).map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cx("flex h-14 flex-col items-center justify-center rounded-xl border transition-all", value === k ? "border-fg bg-[#141414]" : "border-line-2 hover:border-[#333]")}
        >
          <CaptionSample styleKey={k} font={font} words={["the", "clip"]} active={1} size={15} />
          <span className="mt-1 text-[10.5px] text-muted">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Small 9:16-ish frame with the hook line and a caption line in the chosen fonts/styles. */
function LivePreview({ value }: { value: ProduceOptions }) {
  const hookStyle = value.hook_same_style ? value.subtitle_style : value.hook_subtitle_style;
  const hookFont = value.hook_same_style ? value.caption_font : value.hook_font;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="relative flex aspect-[9/12] flex-col items-center justify-center overflow-hidden rounded-xl border border-line-2 bg-[radial-gradient(ellipse_at_50%_40%,#3a2a24_0%,#120d0b_70%)] px-2 text-center">
        <span className="label absolute left-2 top-2 !text-[9px]">Hook</span>
        {value.hook ? (
          <CaptionSample styleKey={hookStyle} font={hookFont} words={["He", "lost", "two", "accounts"]} active={2} size={17} />
        ) : (
          <span className="text-[11px] text-dim">Hook kapalı</span>
        )}
      </div>
      <div className="relative flex aspect-[9/12] flex-col items-center justify-end overflow-hidden rounded-xl border border-line-2 bg-[radial-gradient(ellipse_at_50%_35%,#2c3440_0%,#0b0d10_70%)] px-2 pb-[28%] text-center">
        <span className="label absolute left-2 top-2 !text-[9px]">Altyazı</span>
        {value.subtitles ? (
          <CaptionSample styleKey={value.subtitle_style} font={value.caption_font} words={["one", "simple", "rule"]} active={1} size={17} />
        ) : (
          <span className="text-[11px] text-dim">Altyazı kapalı</span>
        )}
      </div>
    </div>
  );
}

export default function OptionsPanel({
  value,
  onChange,
  options,
  campaigns,
}: {
  value: ProduceOptions;
  onChange: (v: ProduceOptions) => void;
  options: Options | null;
  campaigns: Campaign[];
}) {
  const set = <K extends keyof ProduceOptions>(k: K, v: ProduceOptions[K]) => onChange({ ...value, [k]: v });
  const audio = useRef<HTMLAudioElement | null>(null);
  const voices = options?.voices[value.voice_gender] ?? [];
  const campaign = campaigns.find((c) => c.id === value.campaign_id) || null;
  const person = value.person || { platform: "youtube" as Platform, username: "" };
  const styles = options?.subtitle_styles || { classic: "Klasik beyaz", yellow: "Sarı vurgu", minimal: "Minimal", outline: "Kalın kontur" };

  return (
    <div className="space-y-5">
      <div>
        <div className="label mb-2">Kampanya seç</div>
        <Select
          value={value.campaign_id || ""}
          onChange={(id) => onChange({ ...value, campaign_id: id || null })}
          options={[{ value: "", label: campaigns.length ? "Kampanyasız" : "Kayıtlı kampanya yok" }, ...campaigns.map((c) => ({ value: c.id, label: `${c.name} · ${money(c.cpm)} CPM` }))]}
        />
        {campaign && (
          <div className="mt-2 space-y-1.5 rounded-xl border border-line bg-[#0b0b0b] px-3 py-2.5 text-[12px] text-muted animate-fade-up">
            <div className="flex items-center gap-1.5">
              <span>Açıklamalar:</span>
              {campaign.platforms.map((p) => (
                <span key={p} className="flex items-center gap-1 text-fg">
                  <PlatformIcon platform={p} size={12} /> {PLATFORM_LABEL[p]}
                </span>
              ))}
            </div>
            {campaign.person?.username && (
              <div className="flex items-center gap-1.5">
                Alt bar: <PlatformIcon platform={campaign.person.platform || "kick"} size={12} /> <span className="text-fg">@{campaign.person.username}</span>
                {campaign.person.instagram && <span>· IG @{campaign.person.instagram}</span>}
              </div>
            )}
            {campaign.notes && <div className="line-clamp-2">Kurallar Claude&apos;a iletilir: {campaign.notes}</div>}
          </div>
        )}
      </div>

      <div className="h-px bg-line" />

      <div>
        <div className="label mb-2">Kurgu stili</div>
        <Segmented
          value={value.edit_style}
          onChange={(v) => set("edit_style", v)}
          options={[
            { value: "minimal", label: "Minimal" },
            { value: "balanced", label: "Dengeli" },
            { value: "aggressive", label: "Agresif" },
          ]}
        />
        <p className="mt-2 text-[12px] leading-snug text-muted">{EDIT_HINT[value.edit_style]}</p>
      </div>

      <div className="h-px bg-line" />

      <LivePreview value={value} />

      <div className="space-y-3">
        <Toggle checked={value.subtitles} onChange={(v) => set("subtitles", v)} label="Altyazı" hint="Kelime kelime vurgulamalı, Whisper zamanlarıyla birebir senkron; kesilen dolgu kelimeleri altyazıdan da düşer." />
        {value.subtitles && (
          <div className="space-y-2 animate-fade-up">
            <StyleGrid value={value.subtitle_style} onChange={(k) => set("subtitle_style", k)} styles={styles} font={value.caption_font} />
            <div className="label pt-1">Altyazı fontu</div>
            <FontPicker value={value.caption_font} onChange={(f) => set("caption_font", f)} styleKey={value.subtitle_style} />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Toggle
          checked={value.hook}
          onChange={(v) => set("hook", v)}
          label="Hook seslendirmesi"
          hint="Her klibin başına 3-5 sn'lik merak uyandıran İngilizce intro; seslendirmeyle kelime kelime senkron altyazılı."
        />
        {value.hook && (
          <div className="space-y-3 animate-fade-up">
            <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
              <Select
                value={value.voice_gender}
                onChange={(g) => onChange({ ...value, voice_gender: g, voice: options?.voices[g]?.[0] })}
                options={[
                  { value: "male", label: "Erkek" },
                  { value: "female", label: "Kadın" },
                ]}
              />
              <Select value={value.voice || voices[0] || ""} onChange={(v) => set("voice", v)} options={voices.map((v) => ({ value: v, label: v }))} />
              <button
                type="button"
                title="Sesi dinle"
                onClick={() => {
                  audio.current?.pause();
                  audio.current = new Audio(url(`/api/tts/preview?gender=${value.voice_gender}&voice=${value.voice || voices[0] || ""}`));
                  audio.current.play().catch(() => {});
                }}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-line-2 text-muted transition-colors hover:text-fg"
              >
                <IconPlay size={14} />
              </button>
            </div>
            <Toggle checked={value.hook_same_style} onChange={(v) => set("hook_same_style", v)} label="Hook altyazısı ana altyazıyla aynı stilde" />
            {!value.hook_same_style && (
              <div className="space-y-2 animate-fade-up">
                <div className="label">Hook stili</div>
                <StyleGrid value={value.hook_subtitle_style} onChange={(k) => set("hook_subtitle_style", k)} styles={styles} font={value.hook_font} />
                <div className="label pt-1">Hook fontu</div>
                <FontPicker value={value.hook_font} onChange={(f) => set("hook_font", f)} styleKey={value.hook_subtitle_style} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="h-px bg-line" />

      {campaign?.person?.username ? null : (
        <>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px]">Alt bar (klipteki kişi)</span>
              <span className="label">{campaign ? "Kampanyada kişi yok" : "Her zaman açık"}</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <div className="relative">
                <select
                  value={person.platform}
                  onChange={(e) => set("person", { ...person, platform: e.target.value as Platform })}
                  className="h-10 appearance-none rounded-xl border border-line-2 bg-[#0f0f0f] pl-10 pr-3 text-sm outline-none"
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p} className="bg-[#111]">
                      {PLATFORM_LABEL[p]}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                  <PlatformIcon platform={person.platform} size={18} />
                </span>
              </div>
              <Input value={person.username} onChange={(e) => set("person", { ...person, username: e.target.value.replace(/^@/, "") })} placeholder="kullanıcı adı" />
            </div>
            {person.guessed && person.username && <div className="mt-1.5 text-[11.5px] text-muted">Analizden tahmin edildi, düzenleyebilirsin.</div>}
          </div>

          <div className="space-y-3">
            <Toggle checked={value.instagram_on} onChange={(v) => set("instagram_on", v)} label="Instagram ekle" hint="Alt barın altına ikinci satır olarak Instagram hesabı." />
            {value.instagram_on && (
              <div className="animate-fade-up">
                <Input prefix="@" value={value.instagram} onChange={(e) => set("instagram", e.target.value.replace(/^@+/, ""))} placeholder="hesap" />
              </div>
            )}
          </div>

          <div className="h-px bg-line" />
        </>
      )}

      <div>
        <div className="label mb-2">Klip süresi hedefi</div>
        <Segmented
          value={value.duration}
          onChange={(v) => set("duration", v)}
          options={[
            { value: "15-30", label: "15-30 sn" },
            { value: "30-60", label: "30-60 sn" },
            { value: "60-90", label: "60-90 sn" },
            { value: "auto", label: "Otomatik" },
          ]}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Maksimum klip</span>
          <span className="font-mono text-[13px]">{value.max_clips}</span>
        </div>
        <input type="range" min={1} max={20} value={value.max_clips} onChange={(e) => set("max_clips", Number(e.target.value))} className="w-full" />
      </div>

      <div>
        <div className="label mb-2">Kadraj (9:16)</div>
        <Segmented
          value={value.reframe}
          onChange={(v) => set("reframe", v)}
          options={[
            { value: "face", label: "Konuşanı takip" },
            { value: "center", label: "Ortala" },
            { value: "blur", label: "Geniş plan" },
          ]}
        />
      </div>
    </div>
  );
}
