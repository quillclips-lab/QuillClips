"""Convert the bundled TTF fonts into three.js "typeface" JSON for extruded 3D text in Remotion.

three's TTFLoader pulls opentype.js from a CDN, which breaks offline renders, so we convert once
locally with fontTools (OFL fonts, same license as the TTFs).
"""
from __future__ import annotations

import json
import string

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

from .config import FONTS, FONTS3D_DIR, FONTS_DIR

CHARS = string.ascii_letters + string.digits + " $%&!?.,:;'\"-+/()#@*=~<>"


def _fmt(v: float) -> str:
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def _outline(ops: list) -> str:
    """fontTools pen ops -> three.js typeface outline ('m','l','q','b'; endpoint first, then controls)."""
    out: list[str] = []
    cur = None
    start = None
    for op, args in ops:
        if op == "moveTo":
            cur = start = args[0]
            out += ["m", _fmt(cur[0]), _fmt(cur[1])]
        elif op == "lineTo":
            cur = args[0]
            out += ["l", _fmt(cur[0]), _fmt(cur[1])]
        elif op == "qCurveTo":
            pts = list(args)
            if pts[-1] is None:  # closed contour made only of off-curve points
                pts = pts[:-1]
                implied = ((pts[-1][0] + pts[0][0]) / 2, (pts[-1][1] + pts[0][1]) / 2)
                out += ["m", _fmt(implied[0]), _fmt(implied[1])]
                pts = pts + [implied]
            offs, end = pts[:-1], pts[-1]
            for i, c in enumerate(offs):
                nxt = end if i == len(offs) - 1 else ((c[0] + offs[i + 1][0]) / 2, (c[1] + offs[i + 1][1]) / 2)
                out += ["q", _fmt(nxt[0]), _fmt(nxt[1]), _fmt(c[0]), _fmt(c[1])]
            cur = end
        elif op == "curveTo":
            c1, c2, end = args
            out += ["b", _fmt(end[0]), _fmt(end[1]), _fmt(c1[0]), _fmt(c1[1]), _fmt(c2[0]), _fmt(c2[1])]
            cur = end
        elif op in ("closePath", "endPath"):
            if start is not None and cur != start:
                out += ["l", _fmt(start[0]), _fmt(start[1])]
            cur = start = None
    return " ".join(out)


def convert(ttf_path, json_path) -> None:
    font = TTFont(str(ttf_path))
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    hhea = font["hhea"]
    glyphs = {}
    for ch in CHARS:
        name = cmap.get(ord(ch))
        if not name:
            continue
        pen = DecomposingRecordingPen(gs)
        gs[name].draw(pen)
        xs = [p[0] for _, args in pen.value for p in args if p]
        glyphs[ch] = {"ha": gs[name].width, "x_min": min(xs) if xs else 0, "x_max": max(xs) if xs else 0,
                      "o": _outline(pen.value)}
    head = font["head"]
    data = {
        "glyphs": glyphs,
        "familyName": font["name"].getDebugName(1),
        "ascender": hhea.ascent,
        "descender": hhea.descent,
        "underlinePosition": font["post"].underlinePosition,
        "underlineThickness": font["post"].underlineThickness,
        "boundingBox": {"xMin": head.xMin, "yMin": head.yMin, "xMax": head.xMax, "yMax": head.yMax},
        "resolution": upm,
        "original_font_information": {"format": 0},
        "cssFontWeight": "normal",
        "cssFontStyle": "normal",
    }
    json_path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def ensure_typefaces() -> None:
    FONTS3D_DIR.mkdir(parents=True, exist_ok=True)
    for ttf in FONTS.values():
        src = FONTS_DIR / ttf
        dst = FONTS3D_DIR / (src.stem + ".json")
        if src.exists() and not dst.exists():
            convert(src, dst)
