"""Audio for the edited clip, built sample-accurately in numpy (Remotion renders the picture muted):

  kept speech segments (short fades at every jump cut) + hook bed (quiet teaser audio + TTS voice-over)
  + SFX + optional music bed with automatic ducking under speech.
Loudness normalization happens in the final mux (ffmpeg loudnorm).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import ffmpeg_bin
from ..errors import QCError

SR = 48000
FADE = int(0.006 * SR)


def decode(path: Path | str, start: float | None = None, duration: float | None = None) -> np.ndarray:
    cmd = [ffmpeg_bin(), "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{max(0.0, start):.4f}"]
    if duration is not None:
        cmd += ["-t", f"{duration:.4f}"]
    cmd += ["-i", str(path), "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
    p = subprocess.run(cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if p.returncode != 0:
        raise QCError("Ses dosyası okunamadı.", (p.stderr or b"").decode(errors="replace")[-800:])
    return np.frombuffer(p.stdout, np.float32).reshape(-1, 2).copy()


def _fit(x: np.ndarray, n: int) -> np.ndarray:
    if len(x) >= n:
        return x[:n]
    return np.concatenate([x, np.zeros((n - len(x), 2), np.float32)])


def _fades(x: np.ndarray, n: int = FADE) -> np.ndarray:
    n = min(n, len(x) // 2)
    if n > 0:
        ramp = np.linspace(0, 1, n, dtype=np.float32)[:, None]
        x[:n] *= ramp
        x[-n:] *= ramp[::-1]
    return x


def _add(buf: np.ndarray, x: np.ndarray, at: int, gain: float = 1.0) -> None:
    if at < 0:
        x = x[-at:]
        at = 0
    end = min(len(buf), at + len(x))
    if end > at:
        buf[at:end] += x[: end - at] * gain


def _envelope(x: np.ndarray, win: int = int(0.05 * SR)) -> np.ndarray:
    mono = np.abs(x).mean(axis=1)
    k = np.ones(win, np.float32) / win
    return np.convolve(mono, k, mode="same")


def mix(*, proxy: Path, margin: float, plan: dict, out: Path, hook: dict | None = None) -> Path:
    fps = plan["fps"]
    total = int(round(plan["output_duration"] * SR))
    src = decode(proxy)
    voice = np.zeros((total, 2), np.float32)

    # 1) speech, one kept segment at a time, placed exactly on its output frames
    for (s, _e), (f0, f1) in zip(plan["segments"], plan["frames"]):
        a = int(round((s + margin) * SR))
        n = int(round((f1 - f0) / fps * SR))
        seg = _fit(src[a:a + n].copy(), n)
        _add(voice, _fades(seg), int(round(f0 / fps * SR)))

    # 2) hook intro: quiet bed of the teaser + voice-over
    hook_n = int(round(plan["hook_frames"] / fps * SR))
    if hook and hook_n:
        a = int(round((hook["teaser_start"] + margin) * SR))
        bed = _fit(src[a:a + hook_n].copy(), hook_n)
        _add(voice, _fades(bed, int(0.08 * SR)), 0, 0.12)
        tts = decode(hook["tts_path"])
        _add(voice, _fades(tts), int(0.12 * SR), 1.0)

    mixbuf = voice.copy()
    # 3) sound effects
    for ev in plan.get("sfx", []):
        try:
            x = decode(ev["file"])
        except QCError:
            continue
        at = int(round(ev["t"] * SR)) - (len(x) if ev.get("align_end") else 0)
        _add(mixbuf, _fades(x, 64), at, float(ev["gain"]))

    # 4) music bed, ducked under speech
    music = plan.get("music")
    if music:
        try:
            m = decode(music["file"])
        except QCError:
            m = np.zeros((0, 2), np.float32)
        if len(m):
            reps = int(np.ceil(total / len(m)))
            m = np.tile(m, (reps, 1))[:total]
            env = _envelope(voice)
            active = (env > max(0.01, float(np.percentile(env, 60)) * 0.35)).astype(np.float32)
            # attack 60 ms / release 400 ms smoothing of the duck gain
            gain = np.empty(total, np.float32)
            g = 1.0
            att, rel = 1 - np.exp(-1 / (0.06 * SR)), 1 - np.exp(-1 / (0.4 * SR))
            tgt = 1.0 - 0.72 * active
            for i in range(0, total, 64):  # block-wise for speed
                t = tgt[i]
                g += (t - g) * (att if t < g else rel) * 64
                g = min(1.0, max(0.28, g))
                gain[i:i + 64] = g
            fade = np.ones(total, np.float32)
            fi, fo = min(total, SR), min(total, int(1.5 * SR))
            fade[:fi] = np.linspace(0, 1, fi)
            fade[-fo:] *= np.linspace(1, 0, fo)
            mixbuf += m * (gain * fade * float(music["volume"]))[:, None]

    peak = float(np.max(np.abs(mixbuf))) if len(mixbuf) else 0.0
    if peak > 0.98:
        mixbuf *= 0.98 / peak
    sf.write(str(out), mixbuf, SR, subtype="FLOAT")
    return out
