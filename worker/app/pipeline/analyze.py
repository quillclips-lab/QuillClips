"""Whole-video analysis with Opus: summary, YouTube category, speakers, creator guess, realistic clip estimate."""
from __future__ import annotations

import shutil
from pathlib import Path

from .. import claude_cli
from ..config import PLATFORMS, YOUTUBE_CATEGORIES
from . import ffmpeg
from .ingest import cache_dir
from .textfmt import signals_text, tc, transcript_lines

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "primary_category", "secondary_category", "topics", "content_type", "layout",
                 "speakers", "creator", "estimated_clip_count", "language"],
    "properties": {
        "summary": {"type": "string", "description": "2-3 sentences, English"},
        "primary_category": {"type": "string", "enum": YOUTUBE_CATEGORIES},
        "secondary_category": {"type": ["string", "null"], "enum": [*YOUTUBE_CATEGORIES, None]},
        "topics": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
        "content_type": {"type": "string", "enum": ["livestream", "podcast", "interview", "vlog", "gaming",
                                                     "talk", "tutorial", "reaction", "sports", "music", "other"]},
        "layout": {"type": "string", "enum": ["single_speaker", "multi_speaker", "gameplay_with_facecam",
                                              "screen_content", "irl_moving", "mixed"]},
        "language": {"type": "string"},
        "speakers": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["label", "name", "role", "evidence"],
            "properties": {"label": {"type": "string"}, "name": {"type": ["string", "null"]},
                           "role": {"type": "string"}, "evidence": {"type": "string"}}}},
        "creator": {"type": "object", "additionalProperties": False,
                    "required": ["name", "platform", "username", "confidence", "evidence"],
                    "properties": {"name": {"type": ["string", "null"]},
                                   "platform": {"type": "string", "enum": PLATFORMS},
                                   "username": {"type": ["string", "null"]},
                                   "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                                   "evidence": {"type": "string"}}},
        "estimated_clip_count": {"type": "integer", "minimum": 0},
        "estimate_reason": {"type": "string"},
        "main_theme": {"type": "string", "description": "the main subject of the video in a few words, English"},
        "person_expertise": {"type": "string",
                             "description": "who the main person is and what they are known for / expert in"},
        "suggested_brief": {"type": "string",
                            "description": "Turkish, 1-2 sentences: who the person is + which clip angles fit the theme"},
        "suggested_exclude": {"type": "string", "description": "Turkish, comma separated off-topic subjects to skip"},
        "brief_clip_count": {"type": "integer", "minimum": 0,
                             "description": "realistic count of strong clips that fit the BRIEF (or suggested brief)"},
        "brief_estimate_reason": {"type": "string"},
    },
}
SCHEMA["required"] += ["main_theme", "person_expertise", "suggested_brief", "suggested_exclude", "brief_clip_count",
                       "brief_estimate_reason"]

ESTIMATE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["count", "reason"],
                   "properties": {"count": {"type": "integer"}, "reason": {"type": "string"}}}


def brief_block(brief: str, exclude: str, campaign: dict | None) -> str:
    lines = [f"CONTENT BRIEF (primary selection criterion): {brief or '(none given)'}",
             f"EXCLUDED TOPICS (never clip these): {exclude or '(none)'}"]
    if campaign:
        lines.append(f"CAMPAIGN: {campaign.get('name')} — valid platforms: {', '.join(campaign.get('platforms') or [])}")
        if campaign.get("notes"):
            lines.append(f"CAMPAIGN RULES / NOTES: {campaign['notes']}")
    return "\n".join(lines)


def estimate(video: dict, analysis: dict, transcript: dict, brief: str, exclude: str, model: str) -> dict:
    """Re-estimate how many strong clips fit a (new) brief."""
    prompt = f"""A clipper wants short-form clips from this video that fit the brief below.
Count the distinct, strong, standalone moments (15-90 s) that clearly fit the brief and avoid the excluded topics.
Be realistic: side chats and off-brief moments do not count, even if they are funny.

VIDEO SUMMARY: {analysis.get('summary', '')}
{brief_block(brief, exclude, None)}

TRANSCRIPT:
{transcript_lines(transcript)}
"""
    data = claude_cli.call(prompt, model=model, system="You are a senior short-form content strategist. Reply in Turkish.",
                           schema=ESTIMATE_SCHEMA, purpose="brief_estimate")
    return {"brief": brief, "exclude": exclude, "count": max(0, int(data.get("count") or 0)),
            "reason": str(data.get("reason") or "")}


def overview_frames(src: Path, file_hash: str, duration: float, n: int = 8) -> Path:
    d = cache_dir(file_hash) / "overview_frames"
    if d.exists() and len(list(d.glob("*.jpg"))) >= min(n, 2):
        return d
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    for i in range(n):
        t = duration * (i + 0.5) / n
        try:
            ffmpeg.extract_frame(src, t, d / f"frame_{i:02d}_{int(t)}s.jpg", width=768)
        except Exception:
            continue
    return d


def run(video: dict, transcript: dict, signals: dict, model: str, campaign: dict | None = None) -> dict:
    frames_dir = overview_frames(Path(video["path"]), video["hash"], video["duration"])
    frame_list = "\n".join(f"- {p.name} (at {tc(float(p.stem.split('_')[-1][:-1]))})" for p in sorted(frames_dir.glob("*.jpg")))
    prompt = f"""Analyze this long-form video for a short-form clipping studio.

FILE NAME: {video['filename']}
DURATION: {tc(video['duration'])} ({video['duration']:.0f}s)
DETECTED SPEECH LANGUAGE: {transcript.get('language')}

FRAMES: Use the Read tool to look at each of these image files in the current directory before answering
(on-screen overlays, chat boxes, watermarks, channel names and platform UI are strong evidence for the creator
and platform):
{frame_list}

{signals_text(signals)}

{brief_block(video.get('brief') or '', video.get('exclude') or '', campaign)}

FULL TIMESTAMPED TRANSCRIPT:
{transcript_lines(transcript)}
"""
    data = claude_cli.call(prompt, model=model, system=claude_cli.load_prompt("video_analysis.md"), schema=SCHEMA,
                           purpose="video_analysis", image_dir=frames_dir)
    data["brief_estimate"] = {"brief": video.get("brief") or "", "exclude": video.get("exclude") or "",
                              "count": max(0, int(data.get("brief_clip_count") or 0)),
                              "reason": data.get("brief_estimate_reason") or ""}
    if data.get("primary_category") not in YOUTUBE_CATEGORIES:
        data["primary_category"] = "Entertainment"
    if data.get("secondary_category") not in YOUTUBE_CATEGORIES or data.get("secondary_category") == data["primary_category"]:
        data["secondary_category"] = None
    creator = data.get("creator") or {}
    if creator.get("platform") not in PLATFORMS:
        creator["platform"] = "youtube"
    data["creator"] = creator
    return data
