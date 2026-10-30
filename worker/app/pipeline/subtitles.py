"""Word-timing helpers for captions and the hook voice-over (drawing happens in Remotion)."""
from __future__ import annotations

import re

import numpy as np


def chunk_words(words: list[dict], max_words: int, max_chars: int = 22, max_gap: float = 0.55) -> list[list[dict]]:
    """Group words into short caption lines: break on length, pauses and sentence ends."""
    chunks: list[list[dict]] = []
    cur: list[dict] = []
    for w in words:
        if cur:
            text_len = sum(len(x["w"]) + 1 for x in cur) + len(w["w"])
            gap = w["s"] - cur[-1]["e"]
            ends_sentence = bool(re.search(r"[.!?…]$", cur[-1]["w"]))
            if len(cur) >= max_words or text_len > max_chars or gap > max_gap or ends_sentence:
                chunks.append(cur)
                cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    return chunks


def align_text(text: str, timed: list[dict]) -> list[dict]:
    """Keep the exact written text but borrow timing from (possibly misheard) recognized words.

    Each written token is placed by its character position, interpolated over the recognized
    words' character/time positions. Robust to splits/merges like "scariest" vs "scary as".
    """
    toks = text.split()
    if not toks or not timed:
        return []
    src_pos, src_t = [0.0], [timed[0]["s"]]
    c = 0.0
    for w in timed:
        src_pos.append(c)
        src_t.append(w["s"])
        c += len(w["w"]) + 1
        src_pos.append(c - 1)
        src_t.append(w["e"])
    total_src = max(1.0, c - 1)
    total_txt = max(1, len(text))
    out, pos = [], 0
    for tok in toks:
        idx = text.find(tok, pos)
        pos = idx + len(tok)
        s = float(np.interp(idx / total_txt * total_src, src_pos, src_t))
        e = float(np.interp(pos / total_txt * total_src, src_pos, src_t))
        out.append({"w": tok, "s": s, "e": max(e, s + 0.05)})
    return out


def proportional_words(text: str, start: float, end: float) -> list[dict]:
    """Fallback timing when no word timestamps exist (translations, TTS without alignment)."""
    toks = text.split()
    if not toks:
        return []
    total = sum(len(t) + 2 for t in toks)
    t = start
    out = []
    for tok in toks:
        d = (end - start) * (len(tok) + 2) / total
        out.append({"w": tok, "s": t, "e": t + d * 0.92})
        t += d
    return out
