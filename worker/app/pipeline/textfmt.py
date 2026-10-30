"""Formatting transcript + signals into compact, timestamped text for Claude."""
from __future__ import annotations


def tc(t: float) -> str:
    t = max(0.0, t)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:04.1f}" if h else f"{int(m):02d}:{s:04.1f}"


def transcript_lines(transcript: dict, start: float = 0, end: float | None = None) -> str:
    """One line per whisper segment: [start] text  (seconds also given for exact math)."""
    rows = []
    for seg in transcript["segments"]:
        if seg["e"] < start or (end is not None and seg["s"] > end):
            continue
        rows.append(f"[{seg['s']:.1f}-{seg['e']:.1f}s | {tc(seg['s'])}] {seg['text']}")
    return "\n".join(rows)


def signals_text(signals: dict) -> str:
    peaks = ", ".join(f"{p['t']:.0f}s(+{p['boost_db']}dB,{p['kind']})" for p in signals.get("energy_peaks", []))
    laughs = ", ".join(f"{t:.0f}s" for t in signals.get("laughter_text", [])[:60])
    hot = sorted(signals.get("per_minute", []), key=lambda m: m["rel_db"], reverse=True)[:12]
    hot_txt = ", ".join(f"min {m['min']} ({m['rel_db']:+.1f}dB, {m['cuts']} cuts)" for m in sorted(hot, key=lambda m: m["min"]))
    scenes = signals.get("scene_changes", [])
    scene_txt = ", ".join(f"{t:.0f}s" for t in scenes[:150]) + (" ..." if len(scenes) > 150 else "")
    return (
        f"AUDIO ENERGY PEAKS (shouting, laughter, hype; dB above the local 60s baseline): {peaks or 'none'}\n"
        f"LAUGHTER MENTIONED IN TRANSCRIPT: {laughs or 'none'}\n"
        f"LOUDEST MINUTES: {hot_txt or 'n/a'}\n"
        f"SCENE CHANGES ({len(scenes)} total): {scene_txt or 'none'}"
    )


def clip_text(transcript: dict, start: float, end: float) -> str:
    words = [w["w"] for seg in transcript["segments"] for w in seg["words"] if w["s"] >= start - 0.05 and w["e"] <= end + 0.05]
    return " ".join(words)
