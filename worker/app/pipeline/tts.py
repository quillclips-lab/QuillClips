"""Hook voice-over: Kokoro (kokoro-onnx, local) with Piper as fallback."""
from __future__ import annotations

import logging
import threading
import wave
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import KOKORO_VOICES
from ..errors import QCError

log = logging.getLogger("qc.tts")
_kokoro = None
_piper: dict = {}
_lock = threading.Lock()


def _kokoro_engine():
    global _kokoro
    with _lock:
        if _kokoro is None:
            from kokoro_onnx import Kokoro
            from ..assets_dl import kokoro_paths
            model, voices = kokoro_paths()
            _kokoro = Kokoro(str(model), str(voices))
        return _kokoro


def _synth_kokoro(text: str, voice: str, out: Path) -> Path:
    k = _kokoro_engine()
    samples, sr = k.create(text, voice=voice, speed=1.08, lang="en-gb" if voice.startswith("b") else "en-us")
    sf.write(str(out), samples, sr)
    return out


def _synth_piper(text: str, gender: str, out: Path) -> Path:
    from piper import PiperVoice
    from ..assets_dl import piper_voice
    with _lock:
        if gender not in _piper:
            _piper[gender] = PiperVoice.load(str(piper_voice(gender)))
    voice = _piper[gender]
    with wave.open(str(out), "wb") as wf:
        voice.synthesize_wav(text, wf)
    return out


def synthesize(text: str, gender: str, voice: str | None, out: Path, engine: str = "kokoro") -> tuple[Path, str]:
    """-> (wav path, engine actually used)."""
    gender = gender if gender in KOKORO_VOICES else "male"
    voice = voice or KOKORO_VOICES[gender][0]
    errors = []
    if engine != "piper":
        try:
            return _synth_kokoro(text, voice, out), "kokoro"
        except Exception as e:
            log.warning("Kokoro başarısız, Piper deneniyor: %s", e)
            errors.append(f"kokoro: {e}")
    try:
        return _synth_piper(text, gender, out), "piper"
    except Exception as e:
        errors.append(f"piper: {e}")
    raise QCError("Hook seslendirmesi oluşturulamadı (Kokoro ve Piper başarısız).", " | ".join(errors))


def duration(path: Path) -> float:
    info = sf.info(str(path))
    return info.frames / info.samplerate


def trim_silence(path: Path) -> None:
    data, sr = sf.read(str(path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    thr = 10 ** (-45 / 20)
    idx = np.where(np.abs(data) > thr)[0]
    if idx.size:
        data = data[max(0, idx[0] - int(0.03 * sr)): idx[-1] + int(0.08 * sr)]
    sf.write(str(path), data, sr)
