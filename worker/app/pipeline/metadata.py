"""Titles, descriptions and platform captions with the text model (Sonnet)."""
from __future__ import annotations

from .. import claude_cli
from .textfmt import tc

FIELDS = ["youtube_title", "youtube_description", "tiktok_caption", "instagram_caption", "hashtags", "keywords"]
PLATFORM_FIELDS = {"youtube": ["youtube_title", "youtube_description"], "tiktok": ["tiktok_caption"],
                   "instagram": ["instagram_caption"]}
FIELD_SCHEMA = {
    "youtube_title": {"type": "string", "maxLength": 100},
    "youtube_description": {"type": "string"},
    "tiktok_caption": {"type": "string"},
    "instagram_caption": {"type": "string"},
    "hashtags": {"type": "array", "items": {"type": "string"}},
    "keywords": {"type": "array", "items": {"type": "string"}},
}
TITLES_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["titles"],
                 "properties": {"titles": {"type": "array", "items": {"type": "string"}}}}


def fields_for(platforms: list[str] | None) -> list[str]:
    """Only the captions of the campaign's valid platforms (all three when no campaign)."""
    plats = [p for p in (platforms or []) if p in PLATFORM_FIELDS] or list(PLATFORM_FIELDS)
    return [f for p in plats for f in PLATFORM_FIELDS[p]] + ["hashtags", "keywords"]


def _schema(fields: list[str]) -> dict:
    item = {"type": "object", "additionalProperties": False, "required": ["clip", *fields],
            "properties": {"clip": {"type": "integer"}, **{f: FIELD_SCHEMA[f] for f in fields}}}
    return {"type": "object", "additionalProperties": False, "required": ["clips"],
            "properties": {"clips": {"type": "array", "items": item}}}


def _context(video: dict, analysis: dict, person: dict, campaign: dict | None = None) -> str:
    creator = analysis.get("creator") or {}
    name = person.get("name") or creator.get("name") or "unknown"
    platform = person.get("platform") or creator.get("platform") or "unknown"
    username = person.get("username") or creator.get("username") or ""
    ig = person.get("instagram") or ""
    out = (f"SOURCE VIDEO: {video['filename']}\nSUMMARY: {analysis.get('summary', '')}\n"
           f"CATEGORY: {analysis.get('primary_category')}\nTOPICS: {', '.join(analysis.get('topics', []))}\n"
           f"PERSON IN THE CLIP: {name} — {analysis.get('person_expertise') or ''} — platform: {platform} — "
           f"username: {('@' + username) if username else 'unknown'}{' — instagram: @' + ig if ig else ''}")
    if video.get("brief"):
        out += f"\nCONTENT BRIEF: {video['brief']}"
    if campaign:
        out += (f"\nCAMPAIGN: {campaign.get('name')} — posting on: {', '.join(campaign.get('platforms') or [])}"
                f"\nCAMPAIGN RULES (follow exactly, e.g. required tags/mentions/disclosures): {campaign.get('notes') or '-'}")
    return out


def _clip_block(i: int, clip: dict) -> str:
    sel = clip.get("selection") or {}
    return (f"### clip {i}\nTIME: {tc(clip['start'])}-{tc(clip['end'])} ({clip['end'] - clip['start']:.0f}s)\n"
            f"HOOK: {sel.get('hook_text', '')}\nWHAT HAPPENS: {sel.get('summary', '')}\nWHY IT WORKS: {sel.get('why_viral', '')}\n"
            f"TRANSCRIPT: {sel.get('text', '')}")


def _clean(item: dict, fields: list[str]) -> dict:
    if "youtube_title" in fields:
        title = " ".join(str(item.get("youtube_title", "")).split()).strip().strip('"')
        if len(title) > 99:
            title = title[:96].rsplit(" ", 1)[0] + "..."
        item["youtube_title"] = title
    item["hashtags"] = [h.lstrip("#").replace(" ", "").lower() for h in item.get("hashtags", []) if h.strip()][:6]
    return {k: item.get(k) for k in fields}


def generate(video: dict, analysis: dict, person: dict, clips: list[dict], model: str,
             campaign: dict | None = None) -> dict[int, dict]:
    """Returns {clip_list_index: metadata}. Only the campaign's valid platforms get captions."""
    fields = fields_for((campaign or {}).get("platforms"))
    prompt = (f"{_context(video, analysis, person, campaign)}\n\nWrite metadata for each clip below "
              f"(fields: {', '.join(fields)}). Return one entry per clip with the same `clip` number.\n\n"
              + "\n\n".join(_clip_block(i, c) for i, c in enumerate(clips)))
    data = claude_cli.call(prompt, model=model, system=claude_cli.load_prompt("metadata.md"), schema=_schema(fields),
                           purpose="metadata")
    out: dict[int, dict] = {}
    for item in data.get("clips", []):
        try:
            out[int(item["clip"])] = _clean(item, fields)
        except (KeyError, TypeError, ValueError):
            continue
    return out


def title_alternatives(video: dict, analysis: dict, person: dict, clip: dict, model: str,
                       campaign: dict | None = None) -> list[str]:
    current = (clip.get("metadata") or {}).get("youtube_title", "")
    prompt = (f"{_context(video, analysis, person, campaign)}\n\n{_clip_block(0, clip)}\n\nCURRENT TITLE: {current}\n\n"
              "Write 3 NEW alternative YouTube Shorts titles for this clip, each with a different angle "
              "(e.g. reaction, stakes, quote/claim). Each under 100 characters, follow the title rules.")
    data = claude_cli.call(prompt, model=model, system=claude_cli.load_prompt("metadata.md"), schema=TITLES_SCHEMA,
                           purpose="title_alternatives")
    titles = []
    for t in data.get("titles", [])[:3]:
        t = " ".join(str(t).split()).strip().strip('"')
        titles.append(t if len(t) < 100 else t[:96].rsplit(" ", 1)[0] + "...")
    return titles


TRANSLATE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["lines"],
                    "properties": {"lines": {"type": "array", "items": {"type": "string"}}}}


def translate_lines(lines: list[str], language: str, model: str) -> list[str]:
    """Translate subtitle phrases to natural, short spoken English (1:1 line mapping)."""
    numbered = "\n".join(f"{i}. {l}" for i, l in enumerate(lines))
    prompt = (f"Translate these {len(lines)} subtitle lines from '{language}' into natural, punchy spoken English. "
              f"Keep the same number of lines in the same order, one translation per line, short enough for on-screen "
              f"captions. Return them in `lines` without numbers.\n\n{numbered}")
    data = claude_cli.call(prompt, model=model, system="You are a professional subtitle translator.",
                           schema=TRANSLATE_SCHEMA, purpose="subtitle_translation")
    out = [str(x) for x in data.get("lines", [])]
    if len(out) != len(lines):
        raise ValueError("çeviri satır sayısı uyuşmadı")
    return out
