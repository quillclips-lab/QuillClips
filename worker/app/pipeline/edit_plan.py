"""Edit plan (EDL): Opus decides the edit, this module validates it and turns it into frame-accurate
render props for the Remotion composition (+ an audio plan for the ffmpeg/numpy mixer).

EDL times are clip-relative seconds in the ORIGINAL clip. Render props use OUTPUT seconds/frames
(after the hook intro and after jump cuts).
"""
from __future__ import annotations

import hashlib
import logging
import math

import numpy as np

from .. import claude_cli
from ..errors import ClaudeLimitError
from . import sfx as sfxlib
from .speakers import face_at
from .subtitles import chunk_words

log = logging.getLogger("qc.edit")

LAYOUTS = ["speaker", "face", "split", "wide"]
ENTERS = ["cut", "pan"]
ZOOM_STYLES = ["punch", "slow"]
POPUP_ANIMS = ["pop", "slam", "typewriter", "bounce", "slide_up", "glitch", "wave", "blur_in", "highlight", "counter"]
POPUP_POS = ["top", "upper", "center"]
MOTIONS_3D = ["orbit", "push", "flip"]
TRANSITIONS = ["whip", "zoom", "glitch", "flash", "blur", "shake"]
SFX_TYPES = sfxlib.CATEGORIES
GRADES = ["clean", "warm", "cinematic", "punchy"]
STYLE_NAMES = {"minimal": "Minimal", "balanced": "Balanced", "aggressive": "Aggressive"}
TRANSITION_FRAMES = {"whip": 10, "zoom": 12, "glitch": 10, "flash": 8, "blur": 12, "shake": 10}

# caps: (per 10 s) zooms, popups, sfx ; (whole clip) transitions, text3d
CAPS = {
    "minimal": {"zooms": 1, "popups": 1, "sfx": 2, "transitions": 1, "text3d": 1, "labels": 1},
    "balanced": {"zooms": 2, "popups": 2, "sfx": 4, "transitions": 3, "text3d": 1, "labels": 2},
    "aggressive": {"zooms": 4, "popups": 3, "sfx": 7, "transitions": 6, "text3d": 2, "labels": 3},
}


def _span(desc: str = "") -> dict:
    return {"type": "number", "description": desc} if desc else {"type": "number"}


EDL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "grade", "cuts", "shots", "zooms", "popups", "text3d", "labels", "transitions", "sfx",
                 "music", "progress_bar"],
    "properties": {
        "summary": {"type": "string"},
        "grade": {"type": "string", "enum": GRADES},
        "cuts": {"type": "object", "additionalProperties": False, "required": ["remove", "trims"], "properties": {
            "remove": {"type": "array", "items": {"type": "integer"}, "description": "cut candidate ids to remove"},
            "trims": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                  "required": ["start", "end", "reason"],
                                                  "properties": {"start": _span(), "end": _span(),
                                                                 "reason": {"type": "string"}}}}}},
        "shots": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                             "required": ["start", "end", "layout", "faces", "enter"],
                                             "properties": {
                                                 "start": _span(), "end": _span(),
                                                 "layout": {"type": "string", "enum": LAYOUTS},
                                                 "faces": {"type": "array", "items": {"type": "integer"},
                                                           "description": "face: [id]; split: [top id, bottom id]; else []"},
                                                 "enter": {"type": "string", "enum": ENTERS}}}},
        "zooms": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                             "required": ["start", "end", "scale", "style"],
                                             "properties": {"start": _span(), "end": _span(),
                                                            "scale": _span("1.05-1.6"),
                                                            "style": {"type": "string", "enum": ZOOM_STYLES}}}},
        "popups": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                              "required": ["start", "end", "text", "animation", "position"],
                                              "properties": {"start": _span(), "end": _span(),
                                                             "text": {"type": "string"},
                                                             "animation": {"type": "string", "enum": POPUP_ANIMS},
                                                             "position": {"type": "string", "enum": POPUP_POS}}}},
        "text3d": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                              "required": ["start", "end", "text", "motion"],
                                              "properties": {"start": _span(), "end": _span(),
                                                             "text": {"type": "string"},
                                                             "motion": {"type": "string", "enum": MOTIONS_3D}}}},
        "labels": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                              "required": ["start", "end", "face", "text"],
                                              "properties": {"start": _span(), "end": _span(),
                                                             "face": {"type": "integer"},
                                                             "text": {"type": "string"}}}},
        "transitions": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                   "required": ["at", "type"],
                                                   "properties": {"at": _span(),
                                                                  "type": {"type": "string", "enum": TRANSITIONS}}}},
        "sfx": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["at", "type"],
                                           "properties": {"at": _span(),
                                                          "type": {"type": "string", "enum": SFX_TYPES}}}},
        "music": {"type": "object", "additionalProperties": False, "required": ["use", "mood"],
                  "properties": {"use": {"type": "boolean"}, "mood": {"type": "string"}}},
        "progress_bar": {"type": "boolean"},
    },
}


# ------------------------------------------------------------------ prompt

def _words_text(words: list[dict]) -> str:
    lines, cur, t0 = [], [], None
    for w in words:
        if t0 is None:
            t0 = w["s"]
        cur.append(f"{w['w'].strip()}@{w['s']:.2f}")
        if len(cur) >= 10 or w["w"].rstrip().endswith((".", "?", "!")):
            lines.append(" ".join(cur))
            cur, t0 = [], None
    if cur:
        lines.append(" ".join(cur))
    return "\n".join(lines)


def tracking_text(tracking: dict) -> str:
    if not tracking.get("tracks"):
        return "No faces were tracked (screen content, gameplay or no people). Use `wide`/`speaker` shots only."
    out = []
    for fid, tr in sorted(tracking["tracks"].items()):
        s = tr["summary"]
        side = "left" if s["center_x"] < 0.4 else "right" if s["center_x"] > 0.6 else "center"
        out.append(f"ID {fid}: {side} of frame (x={s['center_x']:.2f}, y={s['center_y']:.2f}), face height "
                   f"{s['size'] * 100:.0f}% of frame, visible {s['coverage'] * 100:.0f}% of the clip")
    return "\n".join(out)


def speakers_text(timeline: list[dict]) -> str:
    return "\n".join(f"{s['start']:.2f}-{s['end']:.2f}: ID {s['face']}" for s in timeline) or "(unknown)"


def request(*, clip: dict, words: list[dict], tracking: dict, timeline: list[dict], esig: dict, brief: str,
            campaign_notes: str, edit_style: str, model: str, frames_dir, frame_names: list[str],
            source_size: tuple[int, int], music_tracks: list[str] | None = None) -> dict:
    sel = clip.get("selection") or {}
    music_line = (f"available tracks: {', '.join(music_tracks[:20])} (pick a mood word that matches a track name)"
                  if music_tracks else "NONE available or music disabled: set music.use=false and do not mention music in the summary")
    dur = clip["end"] - clip["start"]
    cands = "\n".join(f"#{c['id']} {c['kind']} {c['start']:.2f}-{c['end']:.2f} ({c['text']})"
                      for c in esig["candidates"]) or "(none)"
    peaks = ", ".join(f"{p['t']:.1f}s (+{p['boost_db']} dB)" for p in esig["peaks"]) or "(none)"
    laughs = ", ".join(f"{t:.1f}s" for t in esig["laughter"]) or "(none)"
    visual = sel.get("visual") or {}
    prompt = f"""Plan the edit for this clip.

EDIT STYLE: {STYLE_NAMES.get(edit_style, 'Balanced')}
CLIP LENGTH: {dur:.2f}s (source {source_size[0]}x{source_size[1]}, output vertical 1080x1920)
HOOK (voice-over before the clip, not part of your timeline): {sel.get('hook_text') or '-'}
WHY IT IS VIRAL: {sel.get('why_viral') or '-'}
SUMMARY: {sel.get('summary') or '-'}
SHOT LAYOUT (visual review): {visual.get('layout') or 'unknown'} — {visual.get('note') or ''}
CONTENT BRIEF: {brief or '-'}
CAMPAIGN NOTES: {campaign_notes or '-'}
MUSIC LIBRARY: {music_line}

FACES (tracking summary):
{tracking_text(tracking)}

SPEAKER TIMELINE (who is talking):
{speakers_text(timeline)}

CUT CANDIDATES (remove by id):
{cands}

AUDIO ENERGY PEAKS: {peaks}
LAUGHTER: {laughs}

ANNOTATED FRAMES (open each with the Read tool): {", ".join(frame_names) or "(none)"}

TRANSCRIPT (word@start_seconds, clip-relative):
{_words_text(words)}
"""
    return claude_cli.call(prompt, model=model, system=claude_cli.load_prompt("edit_plan.md"), schema=EDL_SCHEMA,
                           purpose="edit_plan", image_dir=frames_dir if frame_names else None)


def fallback(clip: dict, esig: dict, edit_style: str) -> dict:
    """Deterministic plan when Claude is unavailable for a non-limit reason."""
    sel = clip.get("selection") or {}
    dur = clip["end"] - clip["start"]
    pk = float(sel.get("peak_time") or (clip["start"] + clip["end"]) / 2) - clip["start"]
    pk = min(max(0.5, pk), max(0.6, dur - 1.0))
    remove = [c["id"] for c in esig["candidates"]
              if c["kind"] == "silence" and (c["end"] - c["start"] >= (0.8 if edit_style == "minimal" else 0.35))]
    return {"summary": "Fallback plan: follow the speaker, remove dead air, punch in on the peak moment.",
            "grade": "clean", "cuts": {"remove": remove, "trims": []}, "shots": [],
            "zooms": [{"start": max(0, pk - 0.4), "end": min(dur, pk + 1.8), "scale": 1.18, "style": "punch"}],
            "popups": [], "text3d": [], "labels": [], "transitions": [],
            "sfx": [{"at": max(0, pk - 0.4), "type": "hit"}] if edit_style != "minimal" else [],
            "music": {"use": False, "mood": ""}, "progress_bar": edit_style != "minimal", "fallback": True}


# ------------------------------------------------------------------ validation

def _f(v, default=0.0) -> float:
    try:
        x = float(v)
        return x if math.isfinite(x) else default
    except (TypeError, ValueError):
        return default


def _clean_text(s: str, n: int = 32) -> str:
    s = "".join(ch for ch in str(s or "") if ch.isprintable() and ord(ch) < 0x2000)  # no emoji/pictographs
    return " ".join(s.split())[:n].strip()


def _cap(items: list[dict], n: int, key: str = "start") -> list[dict]:
    items = sorted(items, key=lambda x: x[key])
    if len(items) <= n:
        return items
    step = len(items) / n  # keep an even spread
    return [items[int(i * step)] for i in range(n)]


def validate(edl: dict, *, duration: float, words: list[dict], candidates: list[dict], face_ids: list[int],
             edit_style: str) -> dict:
    caps = CAPS.get(edit_style, CAPS["balanced"])
    per10 = max(1.0, duration / 10)
    D = duration

    def rng(x, lo_len, hi_len):
        s = min(max(0.0, _f(x.get("start"))), D)
        e = min(max(0.0, _f(x.get("end"), s + lo_len)), D)
        if e - s < lo_len:
            e = min(D, s + lo_len)
            s = max(0.0, e - lo_len)
        if e - s > hi_len:
            e = s + hi_len
        return round(s, 3), round(e, 3)

    out: dict = {"summary": str(edl.get("summary") or "")[:600], "fallback": bool(edl.get("fallback"))}
    out["grade"] = edl.get("grade") if edl.get("grade") in GRADES else "clean"

    # cuts
    by_id = {c["id"]: c for c in candidates}
    cuts = edl.get("cuts") or {}
    remove_ids = sorted({int(i) for i in (cuts.get("remove") or []) if isinstance(i, (int, float)) and int(i) in by_id})
    if edit_style == "minimal":
        remove_ids = [i for i in remove_ids if by_id[i]["kind"] == "silence" and by_id[i]["end"] - by_id[i]["start"] >= 0.7]
    for c in candidates:  # dead air at the very start/end always goes
        if c["text"] in ("lead-in", "tail") and c["id"] not in remove_ids:
            remove_ids.append(c["id"])
    trims = []
    for t in cuts.get("trims") or []:
        s, e = _f(t.get("start")), _f(t.get("end"))
        if e - s < 0.15 or s < 0 or e > D:
            continue
        # snap to word boundaries
        if words:
            s = min((w["s"] for w in words), key=lambda x: abs(x - s))
            e = min((w["e"] for w in words), key=lambda x: abs(x - e))
        if e - s >= 0.15:
            trims.append({"start": round(s, 3), "end": round(e, 3), "reason": str(t.get("reason") or "")[:120]})
    removed = [(by_id[i]["start"], by_id[i]["end"]) for i in remove_ids] + [(t["start"], t["end"]) for t in trims]
    removed = _merge(removed)
    if sum(e - s for s, e in removed) > 0.45 * D:  # never gut the clip
        removed = _merge([(by_id[i]["start"], by_id[i]["end"]) for i in remove_ids if by_id[i]["kind"] == "silence"])
        trims = []
    out["cuts"] = {"remove": sorted(remove_ids), "trims": trims}
    out["removed"] = [[round(s, 3), round(e, 3)] for s, e in removed]

    # shots
    fids = set(face_ids)
    shots = []
    for sh in sorted(edl.get("shots") or [], key=lambda x: _f(x.get("start"))):
        s, e = rng(sh, 0.4, D)
        layout = sh.get("layout") if sh.get("layout") in LAYOUTS else "speaker"
        faces = [int(f) for f in (sh.get("faces") or []) if isinstance(f, (int, float)) and int(f) in fids]
        if layout == "face" and not faces:
            layout = "speaker"
        if layout == "split":
            faces = list(dict.fromkeys(faces))
            if len(faces) < 2:
                others = [f for f in sorted(fids) if f not in faces]
                faces = (faces + others)[:2]
            if len(faces) < 2:
                layout = "speaker"
        if shots and s < shots[-1]["end"]:
            s = shots[-1]["end"]
            if e - s < 0.4:
                continue
        shots.append({"start": s, "end": e, "layout": layout, "faces": faces[:2] if layout == "split" else faces[:1],
                      "enter": sh.get("enter") if sh.get("enter") in ENTERS else "cut"})
    out["shots"] = shots

    zooms = []
    for z in edl.get("zooms") or []:
        s, e = rng(z, 0.4, 6.0)
        if any(s < o["end"] and e > o["start"] for o in zooms):
            continue
        zooms.append({"start": s, "end": e, "scale": round(min(1.6, max(1.05, _f(z.get("scale"), 1.15))), 3),
                      "style": z.get("style") if z.get("style") in ZOOM_STYLES else "punch"})
    out["zooms"] = _cap(zooms, math.ceil(caps["zooms"] * per10))

    popups = []
    for p in sorted(edl.get("popups") or [], key=lambda x: _f(x.get("start"))):
        text = _clean_text(p.get("text"), 28)
        if not text:
            continue
        s, e = rng(p, 0.7, 3.0)
        if popups and s < popups[-1]["end"] + 0.15:
            continue
        anim = p.get("animation") if p.get("animation") in POPUP_ANIMS else "pop"
        if anim == "counter" and not any(ch.isdigit() for ch in text):
            anim = "slam"
        popups.append({"start": s, "end": e, "text": text, "animation": anim,
                       "position": p.get("position") if p.get("position") in POPUP_POS else "upper"})
    out["popups"] = _cap(popups, math.ceil(caps["popups"] * per10))

    t3 = []
    for p in sorted(edl.get("text3d") or [], key=lambda x: _f(x.get("start"))):
        text = _clean_text(p.get("text"), 18)
        if not text:
            continue
        s, e = rng(p, 1.2, 3.2)
        if any(s < o["end"] + 0.3 and e > o["start"] for o in t3 + out["popups"]):
            continue
        t3.append({"start": s, "end": e, "text": text,
                   "motion": p.get("motion") if p.get("motion") in MOTIONS_3D else "push"})
    out["text3d"] = t3[:caps["text3d"]]

    labels = []
    for lb in sorted(edl.get("labels") or [], key=lambda x: _f(x.get("start"))):
        text = _clean_text(lb.get("text"), 30)
        face = lb.get("face")
        if not text or not isinstance(face, (int, float)) or int(face) not in fids:
            continue
        s, e = rng(lb, 1.0, 4.0)
        if labels and s < labels[-1]["end"]:
            continue
        labels.append({"start": s, "end": e, "face": int(face), "text": text})
    out["labels"] = labels[:caps["labels"]]

    trs = []
    for t in sorted(edl.get("transitions") or [], key=lambda x: _f(x.get("at"))):
        at = min(max(0.3, _f(t.get("at"))), D - 0.3)
        if trs and at - trs[-1]["at"] < 2.0:
            continue
        trs.append({"at": round(at, 3), "type": t.get("type") if t.get("type") in TRANSITIONS else "flash"})
    out["transitions"] = trs[:caps["transitions"]]

    sfx = []
    for x in sorted(edl.get("sfx") or [], key=lambda x: _f(x.get("at"))):
        at = min(max(0.0, _f(x.get("at"))), D)
        if x.get("type") not in SFX_TYPES or (sfx and at - sfx[-1]["at"] < 0.25):
            continue
        sfx.append({"at": round(at, 3), "type": x["type"]})
    out["sfx"] = _cap(sfx, math.ceil(caps["sfx"] * per10), key="at")
    music = edl.get("music") or {}
    out["music"] = {"use": bool(music.get("use")), "mood": str(music.get("mood") or "")[:40]}
    out["progress_bar"] = bool(edl.get("progress_bar", True))
    return out


def _merge(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[list[float]] = []
    for s, e in sorted(ranges):
        if e <= s:
            continue
        if out and s <= out[-1][1] + 0.05:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(a, b) for a, b in out]


# ------------------------------------------------------------------ props

class TimeMap:
    """Original clip time <-> output time, given the kept segments and the hook intro length."""

    def __init__(self, duration: float, removed: list, offset: float, fps: int):
        kept, t = [], 0.0
        for s, e in removed:
            if s - t >= 0.2:
                kept.append((t, s))
            t = max(t, e)
        if duration - t >= 0.2:
            kept.append((t, duration))
        if not kept:
            kept = [(0.0, duration)]
        self.fps = fps
        self.offset = offset
        self.segments = []
        acc = 0.0
        for s, e in kept:
            f0 = round((offset + acc) * fps)
            acc += e - s
            f1 = round((offset + acc) * fps)
            if f1 > f0:
                self.segments.append({"src_start": s, "src_end": e, "f0": f0, "f1": f1})
        self.total_frames = self.segments[-1]["f1"]
        self.kept_duration = acc

    def to_out(self, t: float, prefer: str = "next") -> float:
        """Output seconds for original time t. Times inside a removed gap snap to the next (or previous) kept frame."""
        prev = None
        for seg in self.segments:
            if t < seg["src_start"]:
                if prefer == "prev" and prev is not None:
                    return prev["f1"] / self.fps
                return seg["f0"] / self.fps
            if t <= seg["src_end"]:
                return seg["f0"] / self.fps + (t - seg["src_start"])
            prev = seg
        return self.segments[-1]["f1"] / self.fps

    def inside(self, t: float) -> bool:
        return any(s["src_start"] <= t <= s["src_end"] for s in self.segments)

    def src_at_frame(self, f: int) -> float | None:
        for seg in self.segments:
            if seg["f0"] <= f < seg["f1"]:
                return seg["src_start"] + (f - seg["f0"]) / self.fps
        return None

    def cut_frames(self) -> list[int]:
        return [s["f0"] for s in self.segments[1:]]


def _smooth_face_path(tracking: dict, face: int, times: np.ndarray, window: float = 0.6) -> np.ndarray | None:
    """[cx, cy, h] per time, zero-phase moving average + small dead zone so the camera doesn't jitter."""
    raw = []
    for t in times:
        b = face_at(tracking, face, float(t))
        if b is None:
            return None
        raw.append([b[0] + b[2] / 2, b[1] + b[3] / 2, b[3]])
    arr = np.array(raw, dtype=float)
    if len(arr) < 3:
        return arr
    dt = times[1] - times[0] if len(times) > 1 else 1 / 30
    k = max(1, int(window / dt))
    kernel = np.ones(k) / k
    pad = np.pad(arr, ((k // 2, k - 1 - k // 2), (0, 0)), mode="edge")
    sm = np.stack([np.convolve(pad[:, i], kernel, mode="valid") for i in range(3)], 1)
    # dead zone: hold position until the subject moves > 1.5% of the frame
    held = sm.copy()
    for i in range(1, len(held)):
        if abs(sm[i, 0] - held[i - 1, 0]) < 0.015 and abs(sm[i, 1] - held[i - 1, 1]) < 0.015:
            held[i, :2] = held[i - 1, :2]
    return held


def _visible(tracking: dict, face: int, t: float, tol: float = 0.6) -> bool:
    tr = tracking["tracks"].get(face)
    if not tr or not tr["t"]:
        return False
    ts = np.array(tr["t"])
    return float(np.min(np.abs(ts - t))) <= tol


class Camera:
    def __init__(self, src_w: int, src_h: int, tracking: dict, timeline: list[dict], fps: int, duration: float):
        self.sw, self.sh = src_w, src_h
        self.tracking = tracking
        self.timeline = timeline
        self.fps = fps
        self.times = np.arange(0, duration + 1 / fps, 1 / fps)
        self.paths = {}
        for fid in tracking.get("tracks", {}):
            p = _smooth_face_path(tracking, fid, self.times)
            if p is not None:
                self.paths[fid] = p
        self.ids = sorted(self.paths)

    def path(self, face: int, t: float):
        p = self.paths.get(face)
        if p is None:
            return None
        i = min(len(p) - 1, max(0, int(round(t * self.fps))))
        return p[i]

    def speaker_at(self, t: float) -> int | None:
        for s in self.timeline:
            if s["start"] <= t < s["end"]:
                f = s["face"]
                break
        else:
            f = self.timeline[-1]["face"] if self.timeline else None
        if f is not None and f in self.paths and _visible(self.tracking, f, t):
            return f
        vis = [i for i in self.ids if _visible(self.tracking, i, t)]
        return vis[0] if vis else (f if f in self.paths else (self.ids[0] if self.ids else None))

    def transform(self, center, pw: int, ph: int, zoom: float, face_y: float = 0.40) -> list[float]:
        """[scale, tx, ty]: draw the full source scaled by `scale` at (tx, ty) inside a pw x ph panel."""
        a = pw / ph
        if self.sw / self.sh > a:
            ch0, cw0 = self.sh, self.sh * a
        else:
            cw0, ch0 = self.sw, self.sw / a
        cw, ch = cw0 / zoom, ch0 / zoom
        if center is None:
            cx, cy = self.sw / 2, self.sh / 2
            top = cy - ch / 2
        else:
            cx, cy = center[0] * self.sw, center[1] * self.sh
            top = cy - face_y * ch
        left = min(max(0.0, cx - cw / 2), self.sw - cw)
        top = min(max(0.0, top), self.sh - ch)
        s = pw / cw
        return [round(s, 5), round(-left * s, 2), round(-top * s, 2)]

    def base_zoom(self, face: int | None, t: float, pw: int, ph: int, target: float) -> float:
        """Zoom so the face is ~`target` of the panel height (never zooms out past the base crop)."""
        p = self.path(face, t) if face is not None else None
        if p is None:
            return 1.0
        a = pw / ph
        ch0 = self.sh if self.sw / self.sh > a else self.sw / a
        face_in_crop = p[2] * self.sh / ch0
        return float(min(2.2, max(1.0, target / max(face_in_crop, 1e-3))))


def _ease(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def zoom_factor(zooms: list[dict], t: float) -> float:
    for z in zooms:
        if z["start"] <= t <= z["end"]:
            if z["style"] == "slow":
                return 1 + (z["scale"] - 1) * _ease((t - z["start"]) / max(0.1, z["end"] - z["start"]))
            ramp = 0.1
            k = min(_ease((t - z["start"]) / ramp), _ease((z["end"] - t) / ramp))
            return 1 + (z["scale"] - 1) * k
    return 1.0


def build_props(*, plan: dict, clip_len: float, words: list[dict], tracking: dict, timeline: list[dict],
                src_w: int, src_h: int, margin: float, fps: int, width: int, height: int,
                hook: dict | None, captions_on: bool, caption_style: dict, hook_style: dict, bar: dict | None,
                edit_style: str, sfx_on: bool, sfx_volume: float, music_on: bool, music_volume: float,
                seed: str, media_url: str, caption_words: list[dict] | None = None) -> tuple[dict, dict]:
    """-> (remotion props, audio plan)."""
    hook_dur = float(hook["duration"]) if hook else 0.0
    hook_frames = round(hook_dur * fps)
    tm = TimeMap(clip_len, plan["removed"], hook_frames / fps, fps)
    cam = Camera(src_w, src_h, tracking, timeline, fps, clip_len)
    half = height // 2
    single_target = 0.30 if edit_style != "minimal" else 0.26
    split_target = 0.42

    shots = plan["shots"]

    def shot_at(t: float) -> dict:
        for sh in shots:
            if sh["start"] <= t < sh["end"]:
                return sh
        return {"layout": "speaker", "faces": [], "enter": "cut", "start": t, "end": t}

    # alternate the framing slightly at every jump cut (classic trick that hides the jump)
    jump_alt = {}
    if edit_style != "minimal":
        for i, seg in enumerate(tm.segments):
            jump_alt[i] = 1.0 if i % 2 == 0 else 1.08

    frames: list[list[float]] = []
    labels_track: dict[int, list] = {}
    pan_len = 0.28

    def single_state(face, t, zoom_extra):
        center = cam.path(face, t) if face is not None else None
        z = (cam.base_zoom(face, t, width, height, single_target) if face is not None else 1.0) * zoom_extra
        return center, z

    def frame_state(t: float, seg_idx: int) -> list[float]:
        sh = shot_at(t)
        zx = zoom_factor(plan["zooms"], t) * jump_alt.get(seg_idx, 1.0)
        layout = sh["layout"]
        if layout == "split" and len(sh["faces"]) == 2 and all(f in cam.paths for f in sh["faces"]):
            a, b = sh["faces"]
            za = cam.base_zoom(a, t, width, half, split_target)
            zb = cam.base_zoom(b, t, width, half, split_target)
            return [1] + cam.transform(cam.path(a, t), width, half, za * zoom_factor(plan["zooms"], t)) + \
                cam.transform(cam.path(b, t), width, half, zb * zoom_factor(plan["zooms"], t))
        if layout == "wide" or not cam.ids:
            if layout == "wide":
                return [2, zx, 0, 0, 0, 0, 0]
            return [0] + cam.transform(None, width, height, zx) + [0, 0, 0]
        face = sh["faces"][0] if layout == "face" and sh["faces"] and sh["faces"][0] in cam.paths else cam.speaker_at(t)
        center, z = single_state(face, t, zx)
        st = [0] + cam.transform(center, width, height, z) + [0, 0, 0]
        # smooth pan into a shot that asked for it
        if sh["enter"] == "pan" and sh["start"] > 0 and t - sh["start"] < pan_len:
            prev = shot_at(sh["start"] - 0.01)
            if prev["layout"] in ("speaker", "face"):
                pf = prev["faces"][0] if prev["layout"] == "face" and prev["faces"] else cam.speaker_at(sh["start"] - 0.01)
                pc, pz = single_state(pf, t, zx)
                p0 = cam.transform(pc, width, height, pz)
                k = _ease((t - sh["start"]) / pan_len)
                st = [0] + [p0[i] + (st[1 + i] - p0[i]) * k for i in range(3)] + [0, 0, 0]
        return [round(v, 3) for v in st]

    # hook teaser: speaker framing over [t0, t0 + hook_dur]
    teaser = None
    if hook:
        t0 = float(hook["teaser_start"])
        for f in range(hook_frames):
            t = min(clip_len, t0 + f / fps)
            face = cam.speaker_at(t) if cam.ids else None
            center, z = single_state(face, t, 1.0)
            frames.append([0] + cam.transform(center, width, height, z) + [0, 0, 0])
        teaser = {"f0": 0, "f1": hook_frames, "src": round(t0 + margin, 3)}
    for i, seg in enumerate(tm.segments):
        for f in range(seg["f0"], seg["f1"]):
            t = seg["src_start"] + (f - seg["f0"]) / fps
            frames.append(frame_state(t, i))

    # labels: face box in output pixels for each frame of the label
    labels = []
    for lb in plan["labels"]:
        f0 = round(tm.to_out(lb["start"]) * fps)
        f1 = round(tm.to_out(lb["end"], "prev") * fps)
        if f1 - f0 < fps * 0.6:
            continue
        anchors = []
        for f in range(f0, f1):
            t = tm.src_at_frame(f)
            st = frames[f] if f < len(frames) else None
            p = cam.path(lb["face"], t) if t is not None else None
            if st is None or p is None or not _visible(tracking, lb["face"], t):
                anchors.append(None)
                continue
            box = face_at(tracking, lb["face"], t)
            if st[0] == 0:
                s, tx, ty = st[1:4]
                oy = 0
            elif st[0] == 1:
                sh = shot_at(t)
                top = sh["faces"][0] == lb["face"]
                s, tx, ty = (st[1:4] if top else st[4:7])
                oy = 0 if top else half
            else:
                anchors.append(None)
                continue
            x, y = box[0] * src_w * s + tx, box[1] * src_h * s + ty + oy
            w, h = box[2] * src_w * s, box[3] * src_h * s
            inside = -w * 0.3 < x < width - w * 0.7 and -h * 0.3 < y - oy < (half if st[0] == 1 else height) - h * 0.7
            anchors.append([round(x), round(y), round(w), round(h)] if inside else None)
        if sum(a is not None for a in anchors) >= len(anchors) * 0.5:
            labels.append({"f0": f0, "f1": f1, "text": lb["text"], "anchors": anchors})

    def out_range(item, lo=0.5):
        s = tm.to_out(item["start"])
        e = max(s + lo, tm.to_out(item["end"], "prev"))
        return round(s, 3), round(min(e, tm.total_frames / fps), 3)

    popups = [{**p, "start": out_range(p)[0], "end": out_range(p)[1]} for p in plan["popups"]]
    text3d = [{**p, "start": out_range(p, 1.0)[0], "end": out_range(p, 1.0)[1]} for p in plan["text3d"]]

    # transitions snap to the nearest jump cut / shot change (they hide the cut)
    cut_frames = tm.cut_frames()
    for sh in shots[1:]:
        if tm.inside(sh["start"]):
            cut_frames.append(round(tm.to_out(sh["start"]) * fps))
    transitions = []
    for tr in plan["transitions"]:
        f = round(tm.to_out(tr["at"]) * fps)
        near = min(cut_frames, key=lambda c: abs(c - f)) if cut_frames else None
        if near is not None and abs(near - f) <= fps * 0.6:
            f = near
        d = TRANSITION_FRAMES[tr["type"]]
        transitions.append({"type": tr["type"], "f0": max(hook_frames, f - d // 2), "f1": f + d - d // 2, "at": f})
    if hook_frames:  # always cut from the hook into the clip with a flash/whip
        transitions.insert(0, {"type": "whip" if edit_style != "minimal" else "flash", "f0": hook_frames - 5,
                               "f1": hook_frames + 5, "at": hook_frames, "hook": True})

    # captions in output time (filler words that were cut disappear with them)
    caps = []
    src_words = caption_words if caption_words is not None else words
    if captions_on and src_words:
        ow = []
        for w in src_words:
            mid = (w["s"] + w["e"]) / 2
            if not tm.inside(mid):
                continue
            s = tm.to_out(max(w["s"], 0.0))
            e = tm.to_out(min(w["e"], clip_len), "prev")
            ow.append({"w": w["w"].strip(), "s": round(s, 3), "e": round(max(e, s + 0.06), 3)})
        chunks = chunk_words(ow, int(caption_style.get("max_words") or 3))
        for i, ch in enumerate(chunks):
            nxt = chunks[i + 1][0]["s"] if i + 1 < len(chunks) else ch[-1]["e"] + 0.5
            caps.append({"s": ch[0]["s"], "e": round(min(nxt, ch[-1]["e"] + 0.45), 3), "words": ch})

    # sfx + music (audio plan, output seconds)
    sfx_events = []
    if sfx_on:
        planned = [{"t": round(tm.to_out(x["at"]), 3), "type": x["type"]} for x in plan["sfx"]]
        for tr in transitions:  # transitions without a nearby sound get a whoosh/glitch
            t = tr["at"] / fps
            if not any(abs(p["t"] - t) < 0.3 for p in planned):
                planned.append({"t": round(t - (0.15 if tr["type"] != "glitch" else 0), 3),
                                "type": "glitch" if tr["type"] == "glitch" else "whoosh"})
        for i, x in enumerate(sorted(planned, key=lambda p: p["t"])):
            f = sfxlib.pick(x["type"], f"{seed}:{i}:{x['type']}")
            if f:
                sfx_events.append({"t": x["t"], "type": x["type"], "file": str(f), "align_end": x["type"] == "riser",
                                   "gain": round(sfxlib.CATEGORY_GAIN.get(x["type"], 0.5) * sfx_volume, 3)})
    music = None
    tracks = sfxlib.music_tracks() if music_on else []
    if music_on and tracks and plan["music"]["use"]:
        mood = plan["music"]["mood"].lower()
        match = [p for p in tracks if mood and any(w in p.stem.lower() for w in mood.split())]
        pool = match or tracks
        h = int(hashlib.md5(seed.encode()).hexdigest(), 16)
        music = {"file": str(pool[h % len(pool)]), "volume": music_volume}

    total_frames = tm.total_frames
    props = {
        "fps": fps, "width": width, "height": height, "durationInFrames": total_frames,
        "media": media_url, "srcWidth": src_w, "srcHeight": src_h,
        "segments": ([{"f0": teaser["f0"], "f1": teaser["f1"], "src": teaser["src"], "teaser": True}] if teaser else []) +
                    [{"f0": s["f0"], "f1": s["f1"], "src": round(s["src_start"] + margin, 3)} for s in tm.segments],
        "cam": frames,
        "grade": plan["grade"],
        "captions": caps,
        "captionStyle": caption_style,
        "hook": ({"f1": hook_frames, "words": hook["words"], "text": hook["text"], "style": hook_style}
                 if hook else None),
        "popups": popups, "text3d": text3d, "labels": labels, "transitions": transitions,
        "progressBar": plan["progress_bar"], "bar": bar,
        "editStyle": edit_style,
    }
    audio = {"segments": [[s["src_start"], s["src_end"]] for s in tm.segments],
             "frames": [[s["f0"], s["f1"]] for s in tm.segments], "fps": fps,
             "hook_frames": hook_frames, "sfx": sfx_events, "music": music,
             "output_duration": total_frames / fps}
    return props, audio


# ------------------------------------------------------------------ readable timeline (UI)

def readable(plan: dict) -> list[dict]:
    """Flat, time-sorted list of edit events for the 'Kurgu planını göster' panel (original clip time)."""
    ev = []
    for s, e in plan.get("removed", []):
        ev.append({"t": s, "end": e, "kind": "cut", "text": f"Kesildi ({e - s:.1f} sn)"})
    layout_tr = {"speaker": "Konuşanı takip", "face": "Tek kişi", "split": "Bölünmüş ekran", "wide": "Geniş plan"}
    for sh in plan.get("shots", []):
        who = ", ".join(f"ID {f}" for f in sh.get("faces", []))
        ev.append({"t": sh["start"], "end": sh["end"], "kind": "shot",
                   "text": f"{layout_tr.get(sh['layout'], sh['layout'])}{' · ' + who if who else ''}"
                           f"{' · pan' if sh.get('enter') == 'pan' else ''}"})
    for z in plan.get("zooms", []):
        ev.append({"t": z["start"], "end": z["end"], "kind": "zoom",
                   "text": f"{'Punch-in' if z['style'] == 'punch' else 'Yavaş yakınlaşma'} x{z['scale']:.2f}"})
    for p in plan.get("popups", []):
        ev.append({"t": p["start"], "end": p["end"], "kind": "text", "text": f"\"{p['text']}\" · {p['animation']}"})
    for p in plan.get("text3d", []):
        ev.append({"t": p["start"], "end": p["end"], "kind": "3d", "text": f"3D \"{p['text']}\" · {p['motion']}"})
    for lb in plan.get("labels", []):
        ev.append({"t": lb["start"], "end": lb["end"], "kind": "label", "text": f"Etiket ID {lb['face']}: {lb['text']}"})
    for t in plan.get("transitions", []):
        ev.append({"t": t["at"], "end": None, "kind": "transition", "text": f"Geçiş: {t['type']}"})
    for x in plan.get("sfx", []):
        ev.append({"t": x["at"], "end": None, "kind": "sfx", "text": f"SFX: {x['type']}"})
    return sorted(ev, key=lambda e: (e["t"], e["kind"]))
