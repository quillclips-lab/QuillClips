"""Paths and default settings. Everything lives under the project root."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER_DIR = ROOT / "worker"
DATA_DIR = Path(os.environ.get("QC_DATA_DIR", ROOT / "data"))
UPLOADS_DIR = DATA_DIR / "uploads"
CLIPS_DIR = DATA_DIR / "clips"
CACHE_DIR = DATA_DIR / "cache"
WORK_DIR = DATA_DIR / "work"
MODELS_DIR = DATA_DIR / "models"
DB_PATH = DATA_DIR / "db.sqlite"
PROMPTS_DIR = ROOT / "prompts"
PUBLIC_DIR = ROOT / "public"                 # served by Next.js and used as Remotion's publicDir
FONTS_DIR = PUBLIC_DIR / "fonts"
FONTS3D_DIR = PUBLIC_DIR / "fonts3d"         # three.js typeface JSON generated from the TTFs
ASSETS_DIR = ROOT / "assets"
SFX_DIR = ASSETS_DIR / "sfx"
MUSIC_DIR = ASSETS_DIR / "music"
REMOTION_DIR = ROOT / "remotion"

for _d in (UPLOADS_DIR, CLIPS_DIR, CACHE_DIR, WORK_DIR, MODELS_DIR, SFX_DIR, MUSIC_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# display name -> TTF file (OFL, bundled locally under public/fonts)
FONTS = {
    "Anton": "Anton-Regular.ttf",
    "Bebas Neue": "BebasNeue-Regular.ttf",
    "Montserrat Black": "Montserrat-Black.ttf",
    "Archivo Black": "ArchivoBlack-Regular.ttf",
}
SUBTITLE_STYLES = {"classic": "Klasik beyaz", "yellow": "Sarı vurgu", "minimal": "Minimal", "outline": "Kalın kontur"}
EDIT_STYLES = {"minimal": "Minimal", "balanced": "Dengeli", "aggressive": "Agresif"}
GRADES = ["clean", "warm", "cinematic", "punchy"]
SHARE_PLATFORMS = ["youtube", "tiktok", "instagram"]

YOUTUBE_CATEGORIES = [
    "Film & Animation",
    "Autos & Vehicles",
    "Music",
    "Pets & Animals",
    "Sports",
    "Travel & Events",
    "Gaming",
    "People & Blogs",
    "Comedy",
    "Entertainment",
    "News & Politics",
    "Howto & Style",
    "Education",
    "Science & Technology",
    "Nonprofits & Activism",
]

PLATFORMS = ["kick", "twitch", "youtube", "tiktok", "instagram", "x", "podcast"]

KOKORO_VOICES = {
    "male": ["am_michael", "am_adam", "am_eric", "am_liam", "am_onyx", "am_puck", "bm_george", "bm_lewis"],
    "female": ["af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "bf_emma", "bf_isabella"],
}

DEFAULT_SETTINGS: dict = {
    "analysis_model": "claude-opus-5-5",
    "text_model": "claude-sonnet-5-5",
    "claude_path": "",
    "claude_timeout_sec": 1200,
    "whisper_model": "auto",
    "whisper_device": "auto",
    "tts_engine": "kokoro",
    "tts_voice_male": "am_michael",
    "tts_voice_female": "af_heart",
    "default_voice_gender": "male",
    "default_subtitle_style": "yellow",
    "default_caption_font": "Montserrat Black",
    "default_hook_font": "Anton",
    "default_hook_same_style": True,
    "default_hook_subtitle_style": "outline",
    "default_edit_style": "balanced",
    "default_duration": "auto",
    "default_max_clips": 8,
    "default_reframe": "face",
    "min_viral_score": 60,
    "min_relevance_score": 60,
    "sfx_enabled": True,
    "sfx_volume": 0.55,
    "music_enabled": True,
    "music_volume": 0.12,
    "remotion_concurrency": 3,
    "remotion_gl": "angle",
    "translate_subtitles": True,
    "output_dir": str(CLIPS_DIR),
    "render_width": 1080,
    "render_height": 1920,
    "video_bitrate": "8M",
    "x264_preset": "medium",
    "fps": 30,
}

DURATION_TARGETS = {
    "15-30": (15, 30),
    "30-60": (30, 60),
    "60-90": (60, 90),
    "auto": (15, 90),
}


def ffmpeg_bin() -> str:
    return os.environ.get("QC_FFMPEG", "ffmpeg")


def ffprobe_bin() -> str:
    return os.environ.get("QC_FFPROBE", "ffprobe")
