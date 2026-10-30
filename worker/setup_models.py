"""First-run model download: fonts, face detector, mouth landmarker, SFX library, Kokoro TTS, Piper fallback, Whisper.

Usage: python setup_models.py [--whisper small] [--skip-piper]
"""
from __future__ import annotations

import argparse
import logging
import sys

from app import assets_dl
from app.config import MODELS_DIR


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--whisper", default=None, help="indirilecek whisper modeli (varsayılan: auto)")
    ap.add_argument("--skip-piper", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from app.pipeline import sfx
    steps = [
        ("Fontlar + 3D yazı fontları", assets_dl.ensure_fonts),
        ("Yüz algılama modeli (YuNet)", assets_dl.yunet_path),
        ("Ağız hareketi modeli (MediaPipe Face Landmarker)", assets_dl.face_landmarker_path),
        ("Ses efekti kütüphanesi (assets/sfx)", sfx.ensure_library),
        ("Kokoro TTS", assets_dl.kokoro_paths),
    ]
    if not args.skip_piper:
        steps += [("Piper (yedek TTS, erkek)", lambda: assets_dl.piper_voice("male")),
                  ("Piper (yedek TTS, kadın)", lambda: assets_dl.piper_voice("female"))]

    failed = False
    for label, fn in steps:
        try:
            print(f"-> {label}")
            fn()
        except Exception as e:  # keep going, report at the end
            failed = True
            print(f"   HATA: {e}")

    print("-> Whisper modeli")
    try:
        from faster_whisper import WhisperModel
        from app.pipeline.transcribe import resolve_model
        name, device, compute = resolve_model(args.whisper or "auto", "auto")
        WhisperModel(name, device=device, compute_type=compute, download_root=str(MODELS_DIR / "whisper"))
        print(f"   {name} ({device}/{compute}) hazır")
    except Exception as e:
        failed = True
        print(f"   HATA: {e}")

    print("Bitti." if not failed else "Bazı modeller indirilemedi; ilk kullanımda tekrar denenecek.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
