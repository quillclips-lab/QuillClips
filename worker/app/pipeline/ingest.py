"""Ingest: fingerprint the upload, probe it, extract 16 kHz mono audio (cached by fingerprint)."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Callable

from ..config import CACHE_DIR, ffmpeg_bin
from ..errors import QCError
from . import ffmpeg

SAMPLE = 16 * 1024 * 1024


def fingerprint(path: Path) -> str:
    """Fast content hash: size + head + middle + tail. Good enough to detect re-uploads."""
    size = path.stat().st_size
    h = hashlib.sha256(str(size).encode())
    with open(path, "rb") as f:
        for off in (0, max(0, size // 2 - SAMPLE // 2), max(0, size - SAMPLE)):
            f.seek(off)
            h.update(f.read(SAMPLE))
    return h.hexdigest()[:24]


def cache_dir(file_hash: str) -> Path:
    d = CACHE_DIR / file_hash
    d.mkdir(parents=True, exist_ok=True)
    return d


def extract_audio(src: Path, file_hash: str, duration: float, on_progress: Callable[[float], None] | None = None) -> Path:
    out = cache_dir(file_hash) / "audio.wav"
    if out.exists() and out.stat().st_size > 1000:
        return out
    tmp = out.with_suffix(".tmp.wav")
    try:
        ffmpeg.run_with_progress([ffmpeg_bin(), "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
                                  "-c:a", "pcm_s16le", str(tmp)], duration, on_progress)
    except QCError as e:
        raise QCError("Videodan ses çıkarılamadı. Dosya bozuk olabilir.", e.detail)
    tmp.replace(out)
    return out
