"""Viral moment selection (Opus, whole-video view) + visual review on extracted frames (Opus vision).

Opus sees the entire timestamped transcript plus audio-energy/laughter/scene signals so it can compare
moments against each other. Its picks are then snapped to word boundaries, de-overlapped and filtered.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from .. import claude_cli
from ..config import DURATION_TARGETS, WORK_DIR
from ..errors import ClaudeLimitError
from . import ffmpeg
from .analyze import brief_block
from .textfmt import clip_text, signals_text, tc, transcript_lines
from .transcribe import all_words

CLIP_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["clips", "skipped_notes"],
    "properties": {
        "clips": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["start", "end", "first_words", "last_words", "score", "relevance_score", "relevance_reason",
                         "scores", "why_viral", "tags", "hook_text", "summary", "peak_time", "crop"],
            "properties": {
                "relevance_score": {"type": "integer", "minimum": 0, "maximum": 100},
                "relevance_reason": {"type": "string"},
                "start": {"type": "number", "description": "seconds, at the first word of the opening sentence"},
                "end": {"type": "number", "description": "seconds, at the last word of the payoff"},
                "first_words": {"type": "string"},
                "last_words": {"type": "string"},
                "score": {"type": "integer", "minimum": 0, "maximum": 100},
                "scores": {"type": "object", "additionalProperties": False,
                           "required": ["hook", "emotion", "controversy", "surprise", "quotability", "energy",
                                        "standalone"],
                           "properties": {k: {"type": "integer", "minimum": 0, "maximum": 10} for k in
                                          ["hook", "emotion", "controversy", "surprise", "quotability", "energy",
                                           "standalone"]}},
                "why_viral": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string", "enum": [
                    "hook", "emotion", "comedy", "anger", "shock", "motivation", "controversy", "quote",
                    "surprise", "celebrity", "energy", "laughter", "visual", "story", "insight"]}},
                "hook_text": {"type": "string"},
                "summary": {"type": "string"},
                "peak_time": {"type": "number"},
                "crop": {"type": "object", "additionalProperties": False,
                         "required": ["mode", "focus", "note"],
                         "properties": {"mode": {"type": "string", "enum": ["face", "center", "blur"]},
                                        "focus": {"type": "string", "enum": ["auto", "left", "center", "right"]},
                                        "note": {"type": "string"}}},
            }}},
        "skipped_notes": {"type": "string"},
        "relevant_moment_count": {"type": "integer"},
        "estimate_reason": {"type": "string"},
    },
}
CLIP_SCHEMA["required"] += ["relevant_moment_count", "estimate_reason"]

VISUAL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["clips"],
    "properties": {"clips": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["clip", "layout", "reframe", "focus_x", "visual_interest", "score_adjust", "best_frame", "note"],
        "properties": {
            "clip": {"type": "integer"},
            "layout": {"type": "string", "enum": ["single_face", "multi_face", "gameplay_with_facecam",
                                                  "screen_content", "wide_scene", "no_people"]},
            "reframe": {"type": "string", "enum": ["face", "center", "blur"]},
            "focus_x": {"type": "number", "description": "0..1 horizontal position of the main subject"},
            "visual_interest": {"type": "integer"},
            "score_adjust": {"type": "integer", "description": "-10..+10"},
            "best_frame": {"type": "string", "description": "file name of the most striking frame"},
            "note": {"type": "string"},
        }}}},
}


def _words_index(transcript: dict) -> list[dict]:
    return all_words(transcript)


def snap(words: list[dict], start: float, end: float, first_words: str = "", last_words: str = "") -> tuple[float, float]:
    """Snap to real word boundaries so cuts never land mid-word (and ideally not mid-sentence)."""
    if not words:
        return start, end

    def tokens(s: str) -> list[str]:
        return ["".join(c for c in t.lower() if c.isalnum()) for t in s.split() if any(c.isalnum() for c in t)]

    def find_seq(seq: list[str], around: float, window: float, want_start: bool) -> int | None:
        if not seq:
            return None
        best, best_d = None, None
        for i, w in enumerate(words):
            t = w["s"] if want_start else w["e"]
            if abs(t - around) > window:
                continue
            j0 = i if want_start else i - len(seq) + 1
            if j0 < 0 or j0 + len(seq) > len(words):
                continue
            cand = ["".join(c for c in words[j0 + k]["w"].lower() if c.isalnum()) for k in range(len(seq))]
            if sum(a == b for a, b in zip(cand, seq)) >= max(1, int(len(seq) * 0.6)):
                d = abs(t - around)
                if best_d is None or d < best_d:
                    best, best_d = i, d
        return best

    fw, lw = tokens(first_words)[:5], tokens(last_words)[-5:]
    si = find_seq(fw, start, 6.0, True)
    if si is None:
        si = min(range(len(words)), key=lambda i: abs(words[i]["s"] - start))
    ei = find_seq(lw, end, 6.0, False)
    if ei is None or ei <= si:
        ei = min(range(len(words)), key=lambda i: abs(words[i]["e"] - end))
    if ei <= si:
        ei = min(len(words) - 1, si + 1)
    s = words[si]["s"]
    e = words[ei]["e"]
    # breathing room without bleeding into the neighbouring words
    prev_end = words[si - 1]["e"] if si > 0 else 0.0
    next_start = words[ei + 1]["s"] if ei + 1 < len(words) else e + 1.0
    s = max(prev_end + 0.02, s - 0.12)
    e = min(next_start - 0.02, e + 0.35)
    return round(max(0.0, s), 3), round(e, 3)


def resnap(transcript: dict, start: float, end: float) -> tuple[float, float]:
    """Used after manual nudges: keep the user's intent but land on word boundaries."""
    return snap(_words_index(transcript), start, end)


def select_clips(video: dict, analysis: dict, transcript: dict, signals: dict, *, duration_key: str,
                 max_clips: int, min_score: int, model: str, brief: str = "", exclude: str = "",
                 campaign: dict | None = None, min_relevance: int = 60) -> tuple[list[dict], dict]:
    """-> (picks, info{relevant_moment_count, estimate_reason, dropped_off_brief, skipped_notes})."""
    lo, hi = DURATION_TARGETS.get(duration_key, DURATION_TARGETS["auto"])
    creator = analysis.get("creator") or {}
    prompt = f"""Find the best short-form clips in this video for the brief below.

{brief_block(brief, exclude, campaign)}
PERSON / EXPERTISE: {analysis.get('person_expertise') or '-'}
MAIN THEME: {analysis.get('main_theme') or '-'}

VIDEO: {video['filename']} — duration {tc(video['duration'])} ({video['duration']:.0f}s)
SUMMARY: {analysis.get('summary', '')}
CATEGORY: {analysis.get('primary_category')} / {analysis.get('secondary_category') or '-'}
CONTENT TYPE: {analysis.get('content_type')} — LAYOUT: {analysis.get('layout')}
CREATOR: {creator.get('name') or 'unknown'} ({creator.get('platform')}: {creator.get('username') or '?'})
SPEAKERS: {", ".join(f"{s.get('label')}={s.get('name') or '?'} ({s.get('role')})" for s in analysis.get('speakers', []))}
TRANSCRIPT LANGUAGE: {transcript.get('language')}

CONSTRAINTS
- Target clip length: {lo}-{hi} seconds{' (choose the natural length of each moment inside this range)' if duration_key == 'auto' else ''}.
- Return at most {max_clips} clips. Fewer is better than weak: only include clips with relevance_score >= {min_relevance}
  AND score >= {min_score}.
- Clips must not overlap.
- start/end are seconds from the transcript timestamps; first_words/last_words must be copied exactly from
  the transcript so the cut can be snapped to word boundaries.

{signals_text(signals)}

FULL TIMESTAMPED TRANSCRIPT (format: [start-end s | timecode] text):
{transcript_lines(transcript)}
"""
    data = claude_cli.call(prompt, model=model, system=claude_cli.load_prompt("clip_selection.md"), schema=CLIP_SCHEMA,
                           purpose="clip_selection")
    words = _words_index(transcript)
    picked: list[dict] = []
    dropped = 0

    def rank(c: dict) -> float:  # relevance first, virality second
        return 0.6 * float(c.get("relevance_score") or 0) + 0.4 * float(c.get("score") or 0)

    for c in sorted(data.get("clips", []), key=rank, reverse=True):
        try:
            score = int(c.get("score", 0))
            relevance = int(c.get("relevance_score", 0))
        except (TypeError, ValueError):
            continue
        if relevance < min_relevance:
            dropped += 1
            continue
        if score < min_score:
            continue
        c["relevance_score"] = max(0, min(100, relevance))
        s, e = snap(words, float(c["start"]), float(c["end"]), c.get("first_words", ""), c.get("last_words", ""))
        if e - s < max(5, lo * 0.6) or e - s > hi * 1.25:
            # a wildly off-range pick usually means bad timestamps; trust the raw values once more
            s, e = snap(words, float(c["start"]), float(c["end"]))
            if e - s < max(5, lo * 0.6) or e - s > hi * 1.35:
                continue
        if any(s < p["end"] and e > p["start"] for p in picked):
            continue
        c.update(start=s, end=e, score=max(0, min(100, score)))
        pk = float(c.get("peak_time") or (s + e) / 2)
        c["peak_time"] = pk if s <= pk <= e else (s + e) / 2
        c["text"] = clip_text(transcript, s, e)
        picked.append(c)
        if len(picked) >= max_clips:
            break
    info = {"relevant_moment_count": max(0, int(data.get("relevant_moment_count") or len(picked))),
            "estimate_reason": str(data.get("estimate_reason") or ""), "dropped_off_brief": dropped,
            "skipped_notes": str(data.get("skipped_notes") or ""), "brief": brief, "exclude": exclude}
    return picked, info


def visual_review(video: dict, clips: list[dict], model: str, job_id: str) -> list[dict]:
    """Extract frames from each pick and let Opus judge layout, crop focus and visual punch."""
    if not clips:
        return clips
    d = WORK_DIR / f"visual_{job_id}"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    src = Path(video["path"])
    per_clip = 3 if len(clips) <= 12 else 2
    lines = []
    for i, c in enumerate(clips):
        times = [c["start"] + 1.0, c["peak_time"], c["end"] - 1.5][:per_clip]
        names = []
        for j, t in enumerate(times):
            name = f"clip{i}_f{j}_{t:.1f}.jpg"
            try:
                ffmpeg.extract_frame(src, t, d / name, width=512)
                names.append(name)
            except Exception:
                pass
        lines.append(f"clip {i} ({tc(c['start'])}-{tc(c['end'])}): {c['summary']}\n  frames: {', '.join(names)}")
    prompt = f"""Source video is {video['width']}x{video['height']}. Each clip will be reframed to vertical 9:16.
Use the Read tool to open every frame file listed below, then judge each clip.

{chr(10).join(lines)}

For each clip decide:
- layout of the shot; reframe: "face" (track the main face), "center" (static center crop) or "blur" (full frame
  over a blurred fill — use for gameplay/screen content, wide shots or multi-person shots that a 9:16 crop would ruin);
- focus_x: horizontal position (0..1) of the subject a 9:16 crop should keep;
- visual_interest 0-10 and score_adjust (-10..+10) for how much the visuals help or hurt virality;
- best_frame: the single most striking frame file name (used behind the hook intro).
"""
    try:
        data = claude_cli.call(prompt, model=model, system="You are a senior short-form video editor. Be decisive and concrete.",
                               schema=VISUAL_SCHEMA, purpose="visual_review", image_dir=d)
    except ClaudeLimitError:
        raise
    except Exception:
        # visual review is an enhancement; transcript-based picks still stand
        return clips
    by_idx = {int(v["clip"]): v for v in data.get("clips", []) if isinstance(v.get("clip"), (int, float))}
    for i, c in enumerate(clips):
        v = by_idx.get(i)
        if not v:
            continue
        adj = max(-10, min(10, int(v.get("score_adjust", 0))))
        c["score"] = max(0, min(100, c["score"] + adj))
        c["visual"] = {
            "layout": v.get("layout"),
            "reframe": v.get("reframe"),
            "focus_x": max(0.0, min(1.0, float(v.get("focus_x", 0.5)))),
            "visual_interest": v.get("visual_interest"),
            "note": v.get("note"),
        }
        bf = str(v.get("best_frame", ""))
        try:
            t = float(bf.rsplit("_", 1)[-1].replace(".jpg", ""))
            if c["start"] <= t <= c["end"]:
                c["peak_time"] = t
        except ValueError:
            pass
    clips.sort(key=lambda c: 0.6 * c.get("relevance_score", 0) + 0.4 * c["score"], reverse=True)
    shutil.rmtree(d, ignore_errors=True)
    return clips
