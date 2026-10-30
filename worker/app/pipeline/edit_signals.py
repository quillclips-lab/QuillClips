"""Clip-level editing signals: removable silences / filler words (numbered cut candidates),
energy peaks and laughter. All times are clip-relative seconds."""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import soundfile as sf

FILLERS = {"um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "hm", "mm", "mhm", "eh"}
# multi-word / context fillers: only when Whisper punctuates them as a separate beat
SOFT_FILLER_RE = re.compile(r"^(like|so|basically|actually|literally|right),$", re.I)
PHRASE_FILLERS = [("you", "know,"), ("i", "mean,"), ("sort", "of,"), ("kind", "of,")]
LAUGH_RE = re.compile(r"\b(ha(ha)+|lol|lmao)\b|\((laughs?|laughter)\)|\[(laughs?|laughter)\]", re.I)

MIN_SILENCE = 0.42   # gaps shorter than this are natural breathing
KEEP_PAD = 0.12      # keep a little air on both sides of a removed silence


def _norm(w: str) -> str:
    return re.sub(r"[^a-z']", "", w.lower())


def candidates(words: list[dict], duration: float) -> list[dict]:
    """-> [{id, kind: silence|filler, start, end, text}] sorted by time."""
    out: list[dict] = []
    if not words:
        return out
    # leading / trailing dead air
    if words[0]["s"] > MIN_SILENCE:
        out.append({"kind": "silence", "start": 0.0, "end": words[0]["s"] - KEEP_PAD, "text": "lead-in"})
    for a, b in zip(words, words[1:]):
        gap = b["s"] - a["e"]
        if gap >= MIN_SILENCE:
            out.append({"kind": "silence", "start": a["e"] + KEEP_PAD, "end": b["s"] - KEEP_PAD,
                        "text": f"{gap:.1f}s pause after \"{a['w'].strip()}\""})
    if duration - words[-1]["e"] > MIN_SILENCE + 0.3:
        out.append({"kind": "silence", "start": words[-1]["e"] + 0.3, "end": duration, "text": "tail"})
    i = 0
    while i < len(words):
        w = words[i]
        raw = w["w"].strip()
        n = _norm(raw)
        if n in FILLERS:
            out.append({"kind": "filler", "start": w["s"], "end": w["e"], "text": raw})
        elif SOFT_FILLER_RE.match(raw):
            out.append({"kind": "filler", "start": w["s"], "end": w["e"], "text": raw})
        elif i + 1 < len(words):
            pair = (n, words[i + 1]["w"].strip().lower())
            if pair in PHRASE_FILLERS:
                out.append({"kind": "filler", "start": w["s"], "end": words[i + 1]["e"],
                            "text": f"{raw} {words[i + 1]['w'].strip()}"})
                i += 1
        i += 1
    out = [c for c in out if c["end"] - c["start"] >= 0.08]
    out.sort(key=lambda c: c["start"])
    for k, c in enumerate(out):
        c["id"] = k + 1
        c["start"], c["end"] = round(max(0.0, c["start"]), 3), round(min(duration, c["end"]), 3)
    return out


def energy_peaks(audio: Path, start: float, duration: float, max_peaks: int = 8) -> list[dict]:
    """Loud moments inside the clip (0.25 s RMS windows vs the clip's own median)."""
    try:
        with sf.SoundFile(str(audio)) as f:
            sr = f.samplerate
            f.seek(int(start * sr))
            x = f.read(int(duration * sr), dtype="float32")
    except Exception:
        return []
    if x.ndim > 1:
        x = x.mean(axis=1)
    win = int(sr * 0.25)
    if len(x) < win * 8:
        return []
    n = len(x) // win
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    dbs = 20 * np.log10(rms + 1e-9)
    voiced = dbs[dbs > -50]
    if voiced.size < 4:
        return []
    med = float(np.median(voiced))
    peaks = []
    for i in np.argsort(dbs)[::-1]:
        if dbs[i] - med < 5:
            break
        t = i * 0.25
        if any(abs(t - p["t"]) < 1.5 for p in peaks):
            continue
        peaks.append({"t": round(t + 0.125, 2), "boost_db": round(float(dbs[i] - med), 1)})
        if len(peaks) >= max_peaks:
            break
    return sorted(peaks, key=lambda p: p["t"])


def laughter(words: list[dict]) -> list[float]:
    return [round(w["s"], 2) for w in words if LAUGH_RE.search(w["w"])]


def compute(words: list[dict], audio: Path, start: float, duration: float) -> dict:
    return {"candidates": candidates(words, duration), "peaks": energy_peaks(audio, start, duration),
            "laughter": laughter(words)}
