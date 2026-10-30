export function tc(sec: number | null | undefined, withMs = false): string {
  if (sec == null || Number.isNaN(sec)) return "--:--";
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const ss = withMs ? r.toFixed(1).padStart(4, "0") : Math.floor(r).toString().padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m.toString().padStart(2, "0")}:${ss}`;
}

export function bytes(n: number | null | undefined): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function compact(n: number): string {
  return new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Dollar amounts (CPM, earnings): $1.5 -> "$1.50", $1234 -> "$1,234". */
export function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
}

export const BRIEF_PLACEHOLDER = "Day trader, günde 20k$ kazandığını anlatıyor. Başarı, disiplin, day trading stratejisi odaklı klipler.";
export const EXCLUDE_PLACEHOLDER = "Hariç tut (opsiyonel) — ör. müzik, rapçiler, kişisel dedikodu";

export const EDIT_STYLE_TR: Record<string, string> = { minimal: "Minimal", balanced: "Dengeli", aggressive: "Agresif" };

export const FONT_NAMES = ["Anton", "Bebas Neue", "Montserrat Black", "Archivo Black"] as const;

export function relTime(ts: number): string {
  const d = Date.now() / 1000 - ts;
  if (d < 60) return "az önce";
  if (d < 3600) return `${Math.floor(d / 60)} dk önce`;
  if (d < 86400) return `${Math.floor(d / 3600)} sa önce`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} gün önce`;
  return new Date(ts * 1000).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

export function dateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const CATEGORY_TR: Record<string, string> = {
  "Film & Animation": "Film ve Animasyon",
  "Autos & Vehicles": "Otomobiller ve Araçlar",
  Music: "Müzik",
  "Pets & Animals": "Evcil Hayvanlar",
  Sports: "Spor",
  "Travel & Events": "Seyahat ve Etkinlikler",
  Gaming: "Oyun",
  "People & Blogs": "Kişiler ve Bloglar",
  Comedy: "Komedi",
  Entertainment: "Eğlence",
  "News & Politics": "Haber ve Politika",
  "Howto & Style": "Nasıl Yapılır ve Stil",
  Education: "Eğitim",
  "Science & Technology": "Bilim ve Teknoloji",
  "Nonprofits & Activism": "Kâr Amacı Gütmeyen",
};

export const TAG_TR: Record<string, string> = {
  hook: "Güçlü hook",
  emotion: "Duygu",
  comedy: "Komedi",
  anger: "Öfke",
  shock: "Şok",
  motivation: "Motivasyon",
  controversy: "Tartışma",
  quote: "Alıntılanabilir",
  surprise: "Sürpriz",
  celebrity: "Ünlü",
  energy: "Enerji",
  laughter: "Kahkaha",
  visual: "Görsel",
  story: "Hikâye",
  insight: "İçgörü",
};

export const SCORE_TR: Record<string, string> = {
  hook: "Hook",
  emotion: "Duygu",
  controversy: "Tartışma",
  surprise: "Sürpriz",
  quotability: "Alıntı",
  energy: "Enerji",
  standalone: "Bağımsızlık",
};

export const STATUS_TR: Record<string, string> = {
  uploaded: "Yüklendi",
  analyzing: "Analiz ediliyor",
  analyzed: "Analiz hazır",
  producing: "Üretiliyor",
  ready: "Klipler hazır",
  error: "Hata",
  paused: "Duraklatıldı",
};

export const CLIP_STATUS_TR: Record<string, string> = {
  queued: "Sırada",
  rendering: "Render",
  done: "Hazır",
  error: "Hata",
  paused: "Duraklatıldı",
};

export const PLATFORM_LABEL: Record<string, string> = {
  kick: "Kick",
  twitch: "Twitch",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
  podcast: "Podcast",
};
