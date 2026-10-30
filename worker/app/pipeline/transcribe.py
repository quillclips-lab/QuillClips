"""Transcription with faster-whisper (word-level timestamps). Cached per file hash + model."""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf

from ..config import MODELS_DIR
from ..errors import QCError
from .ingest import cache_dir

log = logging.getLogger("qc.transcribe")
_models: dict[tuple, object] = {}
_lock = threading.Lock()


def cuda_available() -> bool:
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def resolve_model(name: str, device: str) -> tuple[str, str, str]:
    """auto -> best quality/speed balance for the hardware."""
    use_cuda = cuda_available() if device == "auto" else device == "cuda"
    if name == "auto":
        name = "large-v3-turbo" if use_cuda else "small"
    return name, ("cuda" if use_cuda else "cpu"), ("float16" if use_cuda else "int8")


def get_model(name: str, device: str):
    from faster_whisper import WhisperModel
    key = resolve_model(name, device)
    with _lock:
        if key not in _models:
            log.info("whisper yükleniyor: %s", key)
            try:
                _models[key] = WhisperModel(key[0], device=key[1], compute_type=key[2],
                                            download_root=str(MODELS_DIR / "whisper"))
            except Exception as e:
                if key[1] == "cuda":  # broken CUDA install -> CPU
                    cpu_key = (key[0], "cpu", "int8")
                    _models[key] = WhisperModel(cpu_key[0], device="cpu", compute_type="int8",
                                                download_root=str(MODELS_DIR / "whisper"))
                else:
                    raise QCError("Whisper modeli yüklenemedi (ilk kullanımda internet gerekir).", str(e))
        return _models[key]


def load_audio(path: Path) -> np.ndarray:
    """16 kHz mono float32. Decoded with soundfile (avoids PyAV version breakage in faster-whisper)."""
    data, sr = sf.read(str(path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != 16000:
        n = int(round(len(data) * 16000 / sr))
        data = np.interp(np.linspace(0, len(data) - 1, n), np.arange(len(data)), data).astype(np.float32)
    return data


def transcribe(audio: Path, file_hash: str, duration: float, model_name: str, device: str,
               on_progress: Callable[[float], None] | None = None) -> dict:
    resolved = resolve_model(model_name, device)[0]
    out = cache_dir(file_hash) / f"transcript_{resolved}.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))
    model = get_model(model_name, device)
    segments, info = model.transcribe(load_audio(audio), word_timestamps=True, vad_filter=True, beam_size=5,
                                      condition_on_previous_text=False)
    result = {"language": info.language, "model": resolved, "segments": []}
    for seg in segments:
        words = [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 3)}
                 for w in (seg.words or []) if w.word.strip()]
        result["segments"].append({"s": round(seg.start, 3), "e": round(seg.end, 3), "text": seg.text.strip(),
                                   "words": words})
        if on_progress and duration:
            on_progress(min(1.0, seg.end / duration))
    if not result["segments"]:
        raise QCError("Videoda konuşma bulunamadı. QuillClips konuşma içeren videolar için tasarlandı.")
    out.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def transcribe_short(audio: Path, model_name: str = "small") -> list[dict]:
    """Word timings for a short TTS clip (used to sync hook captions)."""
    model = get_model(model_name if model_name != "auto" else "auto", "auto")
    segments, _ = model.transcribe(load_audio(audio), word_timestamps=True, language="en", beam_size=5)
    return [{"w": w.word.strip(), "s": w.start, "e": w.end} for seg in segments for w in (seg.words or [])
            if w.word.strip()]


def all_words(transcript: dict) -> list[dict]:
    return [w for seg in transcript["segments"] for w in seg["words"]]
