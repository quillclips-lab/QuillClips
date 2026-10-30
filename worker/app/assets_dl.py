"""Lazy downloads of free, local model files (TTS, face detector, fonts).

Everything is cached under data/models (fonts under worker/assets/fonts).
"""
from __future__ import annotations

import logging
import shutil
import tempfile
import urllib.request
from pathlib import Path

from .config import FONTS_DIR, MODELS_DIR

log = logging.getLogger("qc.assets")

KOKORO_FILES = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
}
YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US"
PIPER_VOICES = {
    "male": ("ryan", "high"),
    "female": ("amy", "medium"),
}
FACE_LANDMARKER_URL = ("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/"
                       "float16/latest/face_landmarker.task")
FONT_FILES = {
    "Montserrat-Black.ttf": "https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Black.ttf",
    "Montserrat-ExtraBold.ttf": "https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-ExtraBold.ttf",
    "Montserrat-SemiBold.ttf": "https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-SemiBold.ttf",
    "Anton-Regular.ttf": "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf",
    "BebasNeue-Regular.ttf": "https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf",
    "ArchivoBlack-Regular.ttf": "https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf",
}


def download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    log.info("indiriliyor: %s", url)
    req = urllib.request.Request(url, headers={"User-Agent": "QuillClips/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, tempfile.NamedTemporaryFile(delete=False, dir=dest.parent) as tmp:
        shutil.copyfileobj(r, tmp, length=1 << 20)
        tmp_path = Path(tmp.name)
    tmp_path.replace(dest)
    return dest


def kokoro_paths() -> tuple[Path, Path]:
    d = MODELS_DIR / "kokoro"
    return (download(KOKORO_FILES["kokoro-v1.0.onnx"], d / "kokoro-v1.0.onnx"),
            download(KOKORO_FILES["voices-v1.0.bin"], d / "voices-v1.0.bin"))


def yunet_path() -> Path:
    return download(YUNET_URL, MODELS_DIR / "yunet" / "face_detection_yunet_2023mar.onnx")


def piper_voice(gender: str) -> Path:
    name, quality = PIPER_VOICES.get(gender, PIPER_VOICES["male"])
    stem = f"en_US-{name}-{quality}"
    d = MODELS_DIR / "piper"
    download(f"{PIPER_BASE}/{name}/{quality}/{stem}.onnx.json", d / f"{stem}.onnx.json")
    return download(f"{PIPER_BASE}/{name}/{quality}/{stem}.onnx", d / f"{stem}.onnx")


def face_landmarker_path() -> Path:
    return download(FACE_LANDMARKER_URL, MODELS_DIR / "mediapipe" / "face_landmarker.task")


def ensure_fonts() -> Path:
    for name, url in FONT_FILES.items():
        download(url, FONTS_DIR / name)
    from .fonts3d import ensure_typefaces
    ensure_typefaces()
    return FONTS_DIR


def font(name: str) -> str:
    ensure_fonts()
    return str(FONTS_DIR / name)
