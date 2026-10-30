"""Thin ffmpeg/ffprobe helpers shared by pipeline stages."""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Callable

from ..config import ffmpeg_bin, ffprobe_bin
from ..errors import QCError

_FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def run(args: list[str], *, cwd: Path | None = None, timeout: int | None = None) -> subprocess.CompletedProcess:
    try:
        p = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=cwd,
                           timeout=timeout, creationflags=_FLAGS)
    except FileNotFoundError:
        raise QCError("ffmpeg bulunamadı. Lütfen ffmpeg'i kurup PATH'e ekleyin (README'ye bakın).")
    if p.returncode != 0:
        raise QCError("ffmpeg işlemi başarısız oldu.", (p.stderr or "")[-1500:])
    return p


def probe(path: Path) -> dict:
    p = run([ffprobe_bin(), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    data = json.loads(p.stdout or "{}")
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if v is None:
        raise QCError("Dosyada video akışı bulunamadı. Desteklenen bir video dosyası yükleyin.")
    w, h = int(v.get("width") or 0), int(v.get("height") or 0)
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = abs(int(sd["rotation"]))
    if rot in (90, 270):
        w, h = h, w
    fr = v.get("avg_frame_rate") or v.get("r_frame_rate") or "30/1"
    try:
        num, den = fr.split("/")
        fps = float(num) / float(den) if float(den) else 30.0
    except ValueError:
        fps = 30.0
    duration = float(data.get("format", {}).get("duration") or v.get("duration") or 0)
    return {"width": w, "height": h, "fps": round(fps, 3), "duration": duration, "has_audio": a is not None}


def run_with_progress(args: list[str], total: float, on_progress: Callable[[float], None] | None,
                      cwd: Path | None = None) -> None:
    """Run ffmpeg with -progress pipe:1 and report 0..1."""
    full = [args[0], "-hide_banner", "-nostats", "-progress", "pipe:1", *args[1:]]
    try:
        proc = subprocess.Popen(full, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                errors="replace", cwd=cwd, creationflags=_FLAGS)
    except FileNotFoundError:
        raise QCError("ffmpeg bulunamadı. Lütfen ffmpeg'i kurup PATH'e ekleyin.")
    import threading
    err_lines: list[str] = []
    t = threading.Thread(target=lambda: err_lines.extend(proc.stderr), daemon=True)  # type: ignore[arg-type]
    t.start()
    assert proc.stdout is not None
    for line in proc.stdout:
        m = re.match(r"out_time_(?:us|ms)=(\d+)", line.strip())
        if m and on_progress and total > 0:
            on_progress(min(1.0, int(m.group(1)) / 1_000_000 / total))
    proc.wait()
    t.join(timeout=5)
    if proc.returncode != 0:
        raise QCError("Render sırasında ffmpeg hatası oluştu.", "".join(err_lines)[-2000:])


def extract_frame(src: Path, t: float, dest: Path, width: int = 640) -> Path:
    run([ffmpeg_bin(), "-y", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(src), "-frames:v", "1",
         "-vf", f"scale={width}:-2", "-q:v", "4", str(dest)])
    return dest
