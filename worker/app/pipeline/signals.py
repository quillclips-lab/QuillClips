"""Non-LLM moment signals: audio energy peaks (shouting / laughter-like bursts) and scene changes."""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import ffmpeg_bin
from . import ffmpeg
from .ingest import cache_dir

WIN = 0.5  # seconds per energy window
LAUGH_RE = re.compile(r"\b(ha(ha)+|haha|lol|lmao|laugh(s|ing)?)\b|\((laughs?|laughter)\)|\[(laughs?|laughter)\]", re.I)


def energy_curve(audio: Path) -> np.ndarray:
    """RMS dBFS per WIN-second window, streamed so 2h files stay cheap."""
    vals: list[float] = []
    with sf.SoundFile(str(audio)) as f:
        block = int(f.samplerate * WIN)
        for chunk in f.blocks(blocksize=block, dtype="float32"):
            if chunk.ndim > 1:
                chunk = chunk.mean(axis=1)
            rms = float(np.sqrt(np.mean(np.square(chunk)) + 1e-12))
            vals.append(20 * np.log10(rms + 1e-9))
    return np.array(vals, dtype=np.float32)


def find_peaks(db_curve: np.ndarray, max_peaks: int) -> list[dict]:
    if db_curve.size < 10:
        return []
    voiced = db_curve[db_curve > -55]
    if voiced.size < 10:
        return []
    k = int(60 / WIN)  # 60 s rolling baseline
    pad = np.pad(db_curve, (k // 2, k // 2), mode="edge")
    # rolling median via strided windows (memory-light enough for 2h: ~14k windows)
    windows = np.lib.stride_tricks.sliding_window_view(pad, k)[: db_curve.size]
    baseline = np.median(windows, axis=1)
    p90 = float(np.percentile(voiced, 90))
    excess = db_curve - baseline
    cand = np.where((excess > 6) & (db_curve >= p90 - 2))[0]
    peaks: list[dict] = []
    for i in cand:
        t = i * WIN
        if peaks and t - peaks[-1]["t_end"] <= 3:
            p = peaks[-1]
            p["t_end"] = t + WIN
            if excess[i] > p["boost_db"]:
                p["boost_db"], p["t"] = float(excess[i]), t
            continue
        peaks.append({"t": t, "t_start": t, "t_end": t + WIN, "boost_db": float(excess[i])})
    for p in peaks:
        p["sustained"] = (p["t_end"] - p["t_start"]) >= 2.5
    peaks.sort(key=lambda p: p["boost_db"], reverse=True)
    out = peaks[:max_peaks]
    out.sort(key=lambda p: p["t"])
    return [{"t": round(p["t"], 1), "len": round(p["t_end"] - p["t_start"], 1), "boost_db": round(p["boost_db"], 1),
             "kind": "sustained_loud" if p["sustained"] else "spike"} for p in out]


def scene_changes(src: Path) -> list[float]:
    """Keyframe-only scene detection: fast enough for multi-hour sources."""
    try:
        p = ffmpeg.run([ffmpeg_bin(), "-hide_banner", "-skip_frame", "nokey", "-i", str(src), "-an", "-vf",
                        "scale=160:-2,select='gt(scene,0.32)',showinfo", "-fps_mode", "vfr", "-f", "null", "-"])
    except Exception:
        return []
    return [round(float(m), 2) for m in re.findall(r"pts_time:([\d.]+)", p.stderr or "")]


def laughter_markers(transcript: dict) -> list[float]:
    return [seg["s"] for seg in transcript["segments"] if LAUGH_RE.search(seg["text"])]


def compute(src: Path, audio: Path, file_hash: str, duration: float, transcript: dict) -> dict:
    out = cache_dir(file_hash) / "signals.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))
    curve = energy_curve(audio)
    max_peaks = int(min(80, max(8, duration / 60 * 1.5)))
    scenes = scene_changes(src)
    # per-minute summary: loudness relative to the whole video + scene cut count
    per_min = []
    step = int(60 / WIN)
    med = float(np.median(curve[curve > -55])) if (curve > -55).any() else -30.0
    for m in range(0, max(1, int(np.ceil(curve.size / step)))):
        seg = curve[m * step:(m + 1) * step]
        if seg.size == 0:
            continue
        per_min.append({"min": m, "rel_db": round(float(np.mean(seg)) - med, 1),
                        "cuts": sum(1 for s in scenes if m * 60 <= s < (m + 1) * 60)})
    data = {
        "energy_peaks": find_peaks(curve, max_peaks),
        "scene_changes": scenes,
        "laughter_text": laughter_markers(transcript),
        "per_minute": per_min,
    }
    out.write_text(json.dumps(data), encoding="utf-8")
    return data
