export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8765";

export type Platform = "kick" | "twitch" | "youtube" | "tiktok" | "instagram" | "x" | "podcast";
export type SharePlatform = "youtube" | "tiktok" | "instagram";

/** The person shown in the clip's bottom bar (detected creator or campaign person). */
export interface Streamer {
  name?: string;
  platform: Platform;
  username: string;
  instagram?: string;
  guessed?: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  url: string;
  cpm: number;
  platforms: SharePlatform[];
  drive_url: string | null;
  person: { platform?: Platform; username?: string; instagram?: string } | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  clip_count: number;
  clips_done: number;
  video_count: number;
}

export type CampaignInput = Pick<Campaign, "name" | "url" | "cpm" | "platforms" | "drive_url" | "notes"> & {
  person: { platform: Platform; username: string; instagram: string } | null;
};

export interface BriefEstimate {
  brief: string;
  exclude: string;
  count: number;
  reason: string;
  source?: "selection" | "estimate";
  dropped_off_brief?: number;
}

export interface Analysis {
  summary: string;
  primary_category: string;
  secondary_category: string | null;
  topics: string[];
  content_type: string;
  layout: string;
  language: string;
  speakers: { label: string; name: string | null; role: string; evidence: string }[];
  creator: { name: string | null; platform: Platform; username: string | null; confidence: number; evidence: string };
  estimated_clip_count: number;
  estimate_reason?: string;
  main_theme?: string;
  person_expertise?: string;
  suggested_brief?: string;
  suggested_exclude?: string;
  brief_estimate?: BriefEstimate;
  word_count?: number;
  signal_counts?: { energy_peaks: number; scene_changes: number };
}

export type EditStyle = "minimal" | "balanced" | "aggressive";
export type FontName = "Anton" | "Bebas Neue" | "Montserrat Black" | "Archivo Black";

export interface EdlEvent {
  t: number;
  end: number | null;
  kind: "cut" | "shot" | "zoom" | "text" | "3d" | "label" | "transition" | "sfx";
  text: string;
}

export interface EdlView {
  summary: string;
  style: EditStyle;
  grade: string;
  fallback: boolean;
  clip_duration: number;
  kept_duration: number;
  output_duration: number;
  speakers: { start: number; end: number; face: number }[];
  faces: Record<string, { coverage: number; center_x: number; center_y: number; size: number }>;
  music: string | null;
  progress_bar: boolean;
  events: EdlEvent[];
  sfx_files: { t: number; type: string; file: string }[];
}

export interface JobInfo {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error" | "paused";
  stage: string | null;
  progress: number;
  error: string | null;
}

export interface ClipMetadata {
  youtube_title?: string;
  youtube_description?: string;
  tiktok_caption?: string;
  instagram_caption?: string;
  hashtags?: string[];
  keywords?: string[];
}

export interface RenderOpts {
  hook: boolean;
  voice_gender: "male" | "female";
  voice?: string | null;
  subtitles: boolean;
  subtitle_style: string;
  caption_font?: FontName;
  hook_same_style?: boolean;
  hook_subtitle_style?: string;
  hook_font?: FontName;
  edit_style?: EditStyle;
  reframe: "face" | "center" | "blur";
  person?: Streamer;
  instagram: string;
}

export interface Clip {
  id: string;
  video_id: string;
  video_filename: string;
  idx: number;
  start: number;
  end: number;
  score: number;
  status: "queued" | "rendering" | "done" | "error" | "paused";
  stage: string | null;
  progress: number;
  error: string | null;
  duration: number | null;
  why_viral: string;
  tags: string[];
  scores: Record<string, number>;
  relevance_score: number | null;
  relevance_reason: string | null;
  hook_text: string;
  summary: string;
  text: string;
  visual?: { layout?: string; reframe?: string; focus_x?: number; note?: string } | null;
  render_info?: { hook_duration?: number; tts_engine?: string; faces?: number } | null;
  metadata: ClipMetadata;
  render_opts: RenderOpts;
  shared: Partial<Record<SharePlatform, number | null>>;
  category: string | null;
  person: Partial<Streamer>;
  campaign_id: string | null;
  campaign_name: string | null;
  edit: { summary: string; style: EditStyle; grade: string; fallback: boolean } | null;
  created_at: number;
  updated_at: number;
  file_url: string | null;
  thumb_url: string | null;
}

export interface Video {
  id: string;
  filename: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  status: "uploaded" | "analyzing" | "analyzed" | "producing" | "ready" | "error" | "paused";
  stage: string | null;
  progress: number;
  error: string | null;
  analysis: Analysis | null;
  streamer: Streamer | null;
  options: Partial<ProduceOptions> | null;
  brief: string | null;
  exclude: string | null;
  campaign_id: string | null;
  effective_brief: string;
  created_at: number;
  clip_count: number;
  clips_done: number;
  poster_url: string | null;
  job: JobInfo | null;
  clips?: Clip[];
}

export interface ProduceOptions {
  hook: boolean;
  voice_gender: "male" | "female";
  voice?: string;
  subtitles: boolean;
  subtitle_style: string;
  instagram_on: boolean;
  instagram: string;
  duration: "15-30" | "30-60" | "60-90" | "auto";
  max_clips: number;
  reframe: "face" | "center" | "blur";
  person?: Streamer;
  campaign_id: string | null;
  brief?: string;
  exclude?: string;
  edit_style: EditStyle;
  caption_font: FontName;
  hook_same_style: boolean;
  hook_subtitle_style: string;
  hook_font: FontName;
  fresh?: boolean;
}

export interface Settings {
  analysis_model: string;
  text_model: string;
  claude_path: string;
  claude_timeout_sec: number;
  whisper_model: string;
  whisper_device: string;
  tts_engine: string;
  tts_voice_male: string;
  tts_voice_female: string;
  default_voice_gender: "male" | "female";
  default_subtitle_style: string;
  default_duration: ProduceOptions["duration"];
  default_max_clips: number;
  default_reframe: ProduceOptions["reframe"];
  default_caption_font: FontName;
  default_hook_font: FontName;
  default_hook_same_style: boolean;
  default_hook_subtitle_style: string;
  default_edit_style: EditStyle;
  min_viral_score: number;
  min_relevance_score: number;
  sfx_enabled: boolean;
  sfx_volume: number;
  music_enabled: boolean;
  music_volume: number;
  remotion_concurrency: number;
  remotion_gl: string;
  translate_subtitles: boolean;
  output_dir: string;
  render_width: number;
  render_height: number;
  video_bitrate: string;
  x264_preset: string;
  fps: number;
}

export interface Options {
  categories: string[];
  platforms: Platform[];
  voices: { male: string[]; female: string[] };
  share_platforms: SharePlatform[];
  subtitle_styles: Record<string, string>;
  fonts: FontName[];
  edit_styles: Record<EditStyle, string>;
  whisper_models: string[];
  cuda: boolean;
  sfx: Record<string, { count: number; user: boolean }>;
}

export interface EarningsRow {
  id: string;
  name: string;
  cpm: number;
  platforms: SharePlatform[];
  clips: number;
  clips_done: number;
  shared: number;
  views: number | null;
  estimated: number | null;
}

export interface PlatformStats {
  platform: SharePlatform;
  label: string;
  connected: boolean;
  placeholder: boolean;
  total_views: number;
  followers: number;
  last7: number[];
  best_clip: { title: string; views: number } | null;
}

export interface Dashboard {
  clips_total: number;
  clips_this_week: number;
  pending_share: number;
  rendering: number;
  daily: number[];
  recent_videos: Video[];
  top_clip: Clip | null;
  paused_jobs: number;
  earnings: { campaigns: EarningsRow[]; total: number | null; analytics_connected: boolean };
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function url(path: string) {
  return path.startsWith("http") ? path : `${API_URL}${path}`;
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init || {};
  let res: Response;
  try {
    res = await fetch(url(path), {
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers || {}) } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Worker'a ulaşılamıyor. `npm run dev` ile başlatıldığından emin olun.", 0);
  }
  if (!res.ok) {
    let msg = `İstek başarısız (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

const CHUNK = 8 * 1024 * 1024;

/** Chunked, resumable-on-resync upload straight to the worker (no Next.js body limits). */
export interface UploadContext {
  brief?: string;
  exclude?: string;
  campaign_id?: string | null;
}

export async function uploadVideo(
  file: File,
  onProgress: (fraction: number) => void,
  context?: UploadContext,
  signal?: AbortSignal,
): Promise<Video> {
  const init = await api<{ upload_id: string }>("/api/uploads", {
    method: "POST",
    json: { filename: file.name, size: file.size },
  });
  let offset = 0;
  while (offset < file.size) {
    if (signal?.aborted) throw new ApiError("Yükleme iptal edildi", 0);
    const blob = file.slice(offset, Math.min(offset + CHUNK, file.size));
    let attempt = 0;
    for (;;) {
      try {
        const r = await api<{ received: number }>(`/api/uploads/${init.upload_id}?offset=${offset}`, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": "application/octet-stream" },
          signal,
        });
        offset = r.received;
        break;
      } catch (e) {
        if (++attempt > 3 || signal?.aborted) throw e;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    onProgress(offset / file.size);
  }
  return api<Video>(`/api/uploads/${init.upload_id}/complete`, {
    method: "POST",
    json: {
      filename: file.name,
      brief: context?.brief || "",
      exclude: context?.exclude || "",
      campaign_id: context?.campaign_id || null,
    },
  });
}
