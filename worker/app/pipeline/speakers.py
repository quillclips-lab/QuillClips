"""Local person tracking + active-speaker detection for one clip.

- Faces are detected per sampled frame with OpenCV YuNet and linked into tracks (stable IDs).
- For each tracked face, mediapipe FaceLandmarker runs on the face crop and measures mouth opening
  (jawOpen blendshape + inner-lip distance). Running it on crops is far more reliable than on full
  wide frames, where its short-range detector often misses small faces.
- Mouth *movement* is correlated with speech activity (Whisper word timings) to decide who talks when.

All times are clip-relative seconds (0 = clip start in the source).
"""
from __future__ import annotations

import json
import logging
import subprocess
import threading
from pathlib import Path

import numpy as np

from ..assets_dl import face_landmarker_path, yunet_path
from ..config import ffmpeg_bin

log = logging.getLogger("qc.speakers")

FPS = 8
ANALYSIS_W = 960
_lm = None
_lm_lock = threading.Lock()


def _landmarker():
    global _lm
    with _lm_lock:
        if _lm is None:
            from mediapipe.tasks.python import BaseOptions, vision
            opts = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(face_landmarker_path())),
                                                running_mode=vision.RunningMode.IMAGE, num_faces=1,
                                                output_face_blendshapes=True)
            _lm = vision.FaceLandmarker.create_from_options(opts)
        return _lm


def _mouth_open(crop_bgr: np.ndarray) -> float | None:
    import cv2
    import mediapipe as mp
    img = cv2.cvtColor(cv2.resize(crop_bgr, (224, 224)), cv2.COLOR_BGR2RGB)
    res = _landmarker().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img)))
    if not res.face_landmarks:
        return None
    lm = res.face_landmarks[0]
    face_h = abs(lm[152].y - lm[10].y) or 1e-3
    lips = abs(lm[14].y - lm[13].y) / face_h
    jaw = next((b.score for b in res.face_blendshapes[0] if b.category_name == "jawOpen"), 0.0)
    return float(0.5 * jaw + 0.5 * min(1.0, lips * 5))


def _frames(video: Path, start: float, duration: float, w: int, h: int):
    aw = min(ANALYSIS_W, w)
    ah = int(round(h * aw / w / 2) * 2)
    cmd = [ffmpeg_bin(), "-v", "error", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(video), "-an",
           "-vf", f"fps={FPS},scale={aw}:{ah}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=flags)
    size = aw * ah * 3
    i = 0
    assert proc.stdout is not None
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        yield i / FPS, np.frombuffer(buf, np.uint8).reshape(ah, aw, 3)
        i += 1
    proc.wait()


def _iou(a, b) -> float:
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-9)


def track(video: Path, start: float, duration: float, width: int, height: int,
          on_progress=None) -> dict:
    """Detect + track all faces. Returns {"tracks": {id: {...}}, "samples": n, "fps": FPS}."""
    import cv2
    det = None
    tracks: dict[int, dict] = {}
    active: list[int] = []
    next_id = 0
    n = 0
    total = max(1, int(duration * FPS))
    for t, frame in _frames(video, start, duration, width, height):
        fh, fw = frame.shape[:2]
        if det is None:
            det = cv2.FaceDetectorYN.create(str(yunet_path()), "", (fw, fh), 0.6, 0.3, 5000)
        _, res = det.detect(frame)
        boxes = []
        for r in (res if res is not None else []):
            x, y, bw, bh = (float(v) for v in r[:4])
            if bw * bh < (fw * fh) * 0.0008:  # ignore tiny background faces
                continue
            boxes.append((x / fw, y / fh, bw / fw, bh / fh))
        # greedy association to live tracks
        used = set()
        pairs = []
        for tid in active:
            last = tracks[tid]["box"][-1]
            for j, b in enumerate(boxes):
                iou = _iou(last, b)
                dist = np.hypot(last[0] + last[2] / 2 - b[0] - b[2] / 2, last[1] + last[3] / 2 - b[1] - b[3] / 2)
                score = iou + max(0.0, 0.15 - dist)
                if iou > 0.15 or dist < 0.08:
                    pairs.append((score, tid, j))
        assigned: dict[int, int] = {}
        for score, tid, j in sorted(pairs, reverse=True):
            if tid in assigned or j in used:
                continue
            assigned[tid] = j
            used.add(j)
        for j, b in enumerate(boxes):
            if j in used:
                continue
            tracks[next_id] = {"t": [], "box": [], "mouth": []}
            assigned[next_id] = j
            active.append(next_id)
            next_id += 1
        for tid, j in assigned.items():
            b = boxes[j]
            x0, y0 = int(max(0, (b[0] - b[2] * 0.25) * fw)), int(max(0, (b[1] - b[3] * 0.2) * fh))
            x1, y1 = int(min(fw, (b[0] + b[2] * 1.25) * fw)), int(min(fh, (b[1] + b[3] * 1.2) * fh))
            mouth = _mouth_open(frame[y0:y1, x0:x1]) if x1 - x0 > 16 and y1 - y0 > 16 else None
            tr = tracks[tid]
            tr["t"].append(round(t, 3))
            tr["box"].append([round(v, 4) for v in b])
            tr["mouth"].append(None if mouth is None else round(mouth, 4))
        # drop tracks unseen for 1.5 s
        active = [tid for tid in active if t - tracks[tid]["t"][-1] <= 1.5]
        n += 1
        if on_progress and n % 8 == 0:
            on_progress(min(1.0, n / total))
    # keep meaningful tracks only, renumber by prominence (biggest/most present first)
    keep = {tid: tr for tid, tr in tracks.items() if len(tr["t"]) >= max(3, 0.08 * n)}

    def prominence(tr):
        return len(tr["t"]) * float(np.mean([b[2] * b[3] for b in tr["box"]]))
    ordered = sorted(keep.values(), key=prominence, reverse=True)
    out = {}
    for i, tr in enumerate(ordered):
        boxes = np.array(tr["box"])
        tr["summary"] = {
            "coverage": round(len(tr["t"]) / max(1, n), 2),
            "center_x": round(float(np.mean(boxes[:, 0] + boxes[:, 2] / 2)), 3),
            "center_y": round(float(np.mean(boxes[:, 1] + boxes[:, 3] / 2)), 3),
            "size": round(float(np.mean(boxes[:, 3])), 3),
        }
        out[i] = tr
    return {"tracks": out, "samples": n, "fps": FPS}


def speech_mask(words: list[dict], times: np.ndarray, gap: float = 0.25) -> np.ndarray:
    mask = np.zeros(len(times), bool)
    for w in words:
        mask |= (times >= w["s"] - gap / 2) & (times <= w["e"] + gap / 2)
    return mask


def active_speakers(tracking: dict, words: list[dict], duration: float) -> list[dict]:
    """-> [{"start", "end", "face"}] covering the clip; face = track id who is talking (or framed)."""
    tracks = tracking["tracks"]
    if not tracks:
        return []
    times = np.arange(0, duration, 1 / FPS)
    ids = sorted(tracks)
    # per-track mouth signal + visibility on the common time grid
    mouth = np.full((len(ids), len(times)), np.nan)
    visible = np.zeros((len(ids), len(times)), bool)
    for k, tid in enumerate(ids):
        tr = tracks[tid]
        for t, m in zip(tr["t"], tr["mouth"]):
            i = int(round(t * FPS))
            if 0 <= i < len(times):
                visible[k, i] = True
                if m is not None:
                    mouth[k, i] = m
    # mouth activity = local std + mean abs change over a ±0.4 s window
    win = max(1, int(0.4 * FPS))
    activity = np.zeros_like(mouth)
    for k in range(len(ids)):
        m = mouth[k]
        for i in range(len(times)):
            seg = m[max(0, i - win): i + win + 1]
            seg = seg[~np.isnan(seg)]
            if len(seg) >= 2:
                activity[k, i] = float(np.std(seg) + np.mean(np.abs(np.diff(seg))))
    talking = speech_mask(words, times)
    lively = activity.max() > 0.02  # flat mouths everywhere (e.g. still images) -> fall back to visibility
    choice = np.full(len(times), -1)
    prev = -1
    for i in range(len(times)):
        vis = np.where(visible[:, i])[0]
        if len(vis) == 0:
            choice[i] = prev
            continue
        if len(vis) == 1:
            prev = int(vis[0])
        elif talking[i] and lively:
            acts = activity[vis, i]
            order = np.argsort(acts)[::-1]
            best, second = acts[order[0]], acts[order[1]]
            if prev not in vis or best > second * 1.35 + 0.004:
                prev = int(vis[order[0]])
        elif prev not in vis:
            prev = int(vis[0])  # most prominent visible face
        choice[i] = prev
    # forward/back fill, then collapse into segments and absorb blips < 0.7 s
    for i in range(1, len(choice)):
        if choice[i] < 0:
            choice[i] = choice[i - 1]
    first_valid = next((c for c in choice if c >= 0), 0)
    choice[choice < 0] = first_valid
    segs: list[dict] = []
    for i, c in enumerate(choice):
        t = i / FPS
        if segs and segs[-1]["face"] == ids[c]:
            segs[-1]["end"] = t + 1 / FPS
        else:
            segs.append({"start": t, "end": t + 1 / FPS, "face": ids[c]})
    changed = True
    while changed and len(segs) > 1:
        changed = False
        for i, s in enumerate(segs):
            if s["end"] - s["start"] < 0.7:
                j = i - 1 if i > 0 else i + 1
                if i > 0 and i + 1 < len(segs) and segs[i + 1]["end"] - segs[i + 1]["start"] > segs[i - 1]["end"] - segs[i - 1]["start"]:
                    j = i + 1
                segs[j]["start"] = min(segs[j]["start"], s["start"])
                segs[j]["end"] = max(segs[j]["end"], s["end"])
                segs.pop(i)
                changed = True
                break
        merged = []
        for s in segs:
            if merged and merged[-1]["face"] == s["face"]:
                merged[-1]["end"] = s["end"]
            else:
                merged.append(s)
        segs = merged
    for s in segs:
        s["start"], s["end"] = round(max(0.0, s["start"]), 2), round(min(duration, s["end"]), 2)
    if segs:
        segs[0]["start"], segs[-1]["end"] = 0.0, round(duration, 2)
    return segs


def face_at(tracking: dict, face: int, t: float) -> list[float] | None:
    """Interpolated [x, y, w, h] (normalized) of a track at clip time t; nearest known box if outside."""
    tr = tracking["tracks"].get(face) or tracking["tracks"].get(str(face))
    if not tr or not tr["t"]:
        return None
    ts = np.array(tr["t"])
    i = int(np.searchsorted(ts, t))
    if i <= 0:
        return tr["box"][0]
    if i >= len(ts):
        return tr["box"][-1]
    t0, t1 = ts[i - 1], ts[i]
    if t1 - t0 > 1.0:  # gap: hold the closer one
        return tr["box"][i - 1] if t - t0 < t1 - t - 0 else tr["box"][i]
    a = (t - t0) / (t1 - t0)
    b0, b1 = np.array(tr["box"][i - 1]), np.array(tr["box"][i])
    return list(b0 + (b1 - b0) * a)


def annotated_frames(video: Path, offset: float, tracking: dict, times: list[float], out_dir: Path) -> list[str]:
    """Frames with numbered face boxes so Opus can reference people by ID."""
    import cv2
    out_dir.mkdir(parents=True, exist_ok=True)
    names = []
    for t in times:
        name = f"frame_{t:.1f}s.jpg"
        p = out_dir / name
        subprocess.run([ffmpeg_bin(), "-y", "-v", "error", "-ss", f"{offset + t:.3f}", "-i", str(video), "-frames:v", "1",
                        "-vf", "scale=768:-2", str(p)], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        img = cv2.imread(str(p))
        if img is None:
            continue
        h, w = img.shape[:2]
        for fid in tracking["tracks"]:
            b = face_at(tracking, int(fid), t)
            if b is None:
                continue
            x, y, bw, bh = int(b[0] * w), int(b[1] * h), int(b[2] * w), int(b[3] * h)
            cv2.rectangle(img, (x, y), (x + bw, y + bh), (60, 220, 255), 2)
            cv2.rectangle(img, (x, max(0, y - 26)), (x + 54, y), (60, 220, 255), -1)
            cv2.putText(img, f"ID {fid}", (x + 4, max(18, y - 7)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
        cv2.imwrite(str(p), img)
        names.append(name)
    return names


def save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")


def load(path: Path) -> dict | None:
    if not path.exists():
        return None
    d = json.loads(path.read_text(encoding="utf-8"))
    d["tracks"] = {int(k): v for k, v in d["tracks"].items()}
    return d
