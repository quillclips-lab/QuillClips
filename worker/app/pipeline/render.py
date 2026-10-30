"""Clip render pipeline:

  proxy (clip ± margin, 30 fps CFR) -> speaker detection (tracking + mouth activity)
  -> edit plan (Opus EDL, validated) -> hook voice-over -> Remotion render (picture)
  -> numpy audio mix (speech cuts, hook, SFX, ducked music) -> mux + loudnorm -> thumbnail.

Stages reported to the UI: "Konuşmacı tespiti" -> "Kurgu planı" -> "Render".
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable

from ..config import CACHE_DIR, ROOT, WORK_DIR, ffmpeg_bin
from ..errors import ClaudeLimitError, QCError
from . import audio_mix, edit_plan, edit_signals, ffmpeg, speakers, subtitles, tts
from . import sfx as sfxlib
from .ingest import cache_dir
from .transcribe import transcribe_short

log = logging.getLogger("qc.render")
MARGIN = 0.5
FRAME_TIMES = 6


def _slug(s: str, n: int = 40) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s[:n] or "clip"


_ATTACH = re.compile(r"^[,.!?%:;)'’]")  # whisper splits "$20,000" into "$20" + ",000": glue such tokens back


def clip_words(transcript: dict, start: float, end: float) -> list[dict]:
    out: list[dict] = []
    for seg in transcript["segments"]:
        for w in seg["words"]:
            if not (w["s"] >= start - 0.05 and w["e"] <= end + 0.15):
                continue
            text = w["w"].strip()
            if out and _ATTACH.match(text):
                out[-1]["w"] += text
                out[-1]["e"] = round(w["e"] - start, 3)
            elif text:
                out.append({"w": text, "s": round(w["s"] - start, 3), "e": round(w["e"] - start, 3)})
    return out


def translated_words(transcript: dict, start: float, end: float, translate: Callable[[list[str]], list[str]]) -> list[dict]:
    """Phrase-level English captions for non-English speech (timed across each phrase)."""
    phrases = []
    for seg in transcript["segments"]:
        ws = [w for w in seg["words"] if w["s"] >= start - 0.05 and w["e"] <= end + 0.15]
        if ws:
            phrases.append((ws[0]["s"] - start, ws[-1]["e"] - start, " ".join(w["w"] for w in ws)))
    if not phrases:
        return []
    english = translate([p[2] for p in phrases])
    out = []
    for (s, e, _), text in zip(phrases, english):
        out += subtitles.proportional_words(text, s, e)
    return out


def node_bin() -> str:
    found = shutil.which("node")
    if found:
        return found
    for c in (r"C:\Program Files\nodejs\node.exe", "/usr/local/bin/node", "/usr/bin/node"):
        if Path(c).exists():
            return c
    raise QCError("Node.js bulunamadı (Remotion render için gerekli). 'npm run setup' çalıştırın.")


def make_proxy(src: Path, start: float, end: float, out: Path, fps: int) -> tuple[float, int, int]:
    """Short, seek-friendly copy of the clip range for tracking and Remotion. Returns (margin, w, h)."""
    margin = min(MARGIN, start)
    if not out.exists():
        tmp = out.with_suffix(".tmp.mp4")
        ffmpeg.run([ffmpeg_bin(), "-y", "-v", "error", "-ss", f"{start - margin:.3f}", "-t", f"{end - start + margin + MARGIN:.3f}",
                    "-i", str(src), "-vf", f"scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps={fps}",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-g", "15", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", str(tmp)])
        tmp.replace(out)
    info = ffmpeg.probe(out)
    return margin, int(info["width"]), int(info["height"])


def _remotion(props_path: Path, out: Path, media_dir: Path, settings: dict, on_progress: Callable[[str, float], None]) -> None:
    script = ROOT / "scripts" / "render-remotion.mjs"
    cmd = [node_bin(), str(script), "--props", str(props_path), "--out", str(out), "--media-dir", str(media_dir),
           "--concurrency", str(int(settings.get("remotion_concurrency") or 3)),
           "--gl", str(settings.get("remotion_gl") or "angle"),
           "--bitrate", str(settings.get("video_bitrate") or "8M"),
           "--preset", str(settings.get("x264_preset") or "medium"),
           "--cache", str(CACHE_DIR / "remotion")]
    log_path = media_dir / "remotion.log"
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    with open(log_path, "w", encoding="utf-8") as errlog:
        proc = subprocess.Popen(cmd, cwd=str(ROOT), stdout=subprocess.PIPE, stderr=errlog, text=True, encoding="utf-8",
                                errors="replace", creationflags=flags)
        error = None
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "error" in msg:
                error = msg["error"]
            elif msg.get("stage") == "bundle":
                on_progress("Render (hazırlık)", float(msg.get("progress") or 0))
            elif msg.get("stage") == "render":
                on_progress("Render", float(msg.get("progress") or 0))
        proc.wait()
    if proc.returncode != 0 or not out.exists():
        tail = (error or "") + "\n" + log_path.read_text(encoding="utf-8", errors="replace")[-2000:]
        raise QCError("Remotion render başarısız oldu. Ayrıntı için worker kaydına bakın.", tail[-4000:])


def analyze_speakers(*, proxy: Path, margin: float, pw: int, ph: int, length: float, words: list[dict], work: Path,
                     reframe: str, on_progress: Callable[[float], None]) -> tuple[dict, list[dict]]:
    path = work / "speakers.json"
    data = speakers.load(path)
    if data is None:
        if reframe == "center":
            data = {"tracks": {}, "samples": 0, "fps": speakers.FPS}
        else:
            data = speakers.track(proxy, margin, length, pw, ph, on_progress)
        data["timeline"] = speakers.active_speakers(data, words, length)
        speakers.save(path, data)
    return data, data.get("timeline") or []


def render_clip(*, clip: dict, video: dict, transcript: dict, settings: dict, opts: dict, workdir_name: str,
                translate: Callable[[list[str]], list[str]] | None, context: dict,
                reedit: bool, on_progress: Callable[[str, float], None]) -> dict:
    src = Path(video["path"])
    W, H = int(settings["render_width"]), int(settings["render_height"])
    fps = int(settings.get("fps") or 30)
    start, end = float(clip["start"]), float(clip["end"])
    length = round(end - start, 3)
    sel = clip.get("selection") or {}
    edit_style = opts.get("edit_style") or settings.get("default_edit_style") or "balanced"
    work = WORK_DIR / workdir_name
    work.mkdir(parents=True, exist_ok=True)
    rng_key = f"{start:.3f}_{end:.3f}"
    if (work / "range.txt").exists() and (work / "range.txt").read_text() != rng_key:
        # the clip was nudged: every cached analysis of the old range is stale
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)
    (work / "range.txt").write_text(rng_key)
    words = clip_words(transcript, start, end)

    # 1) speaker detection
    on_progress("Konuşmacı tespiti", 0.0)
    proxy = work / "proxy.mp4"
    margin, pw, ph = make_proxy(src, start, end, proxy, fps)
    reframe = opts.get("reframe", "face")
    tracking, timeline = analyze_speakers(proxy=proxy, margin=margin, pw=pw, ph=ph, length=length, words=words,
                                          work=work, reframe=reframe,
                                          on_progress=lambda p: on_progress("Konuşmacı tespiti", 0.05 + 0.2 * p))

    # 2) edit plan
    on_progress("Kurgu planı", 0.26)
    audio16 = cache_dir(video["hash"]) / "audio.wav"
    esig = edit_signals.compute(words, audio16, start, length)
    face_ids = sorted(int(k) for k in tracking.get("tracks", {}))
    stored = clip.get("edl") or {}
    plan = stored.get("plan") if (not reedit and stored.get("range") == rng_key and stored.get("style") == edit_style) else None
    model = settings["analysis_model"]
    if plan is None:
        frames_dir = work / "frames"
        shutil.rmtree(frames_dir, ignore_errors=True)
        times = [round(length * (i + 0.5) / FRAME_TIMES, 2) for i in range(FRAME_TIMES)]
        names = speakers.annotated_frames(proxy, margin, tracking, times, frames_dir) if face_ids else []
        try:
            raw = edit_plan.request(clip=clip, words=words, tracking=tracking, timeline=timeline, esig=esig,
                                    brief=context.get("brief") or "", campaign_notes=context.get("campaign_notes") or "",
                                    edit_style=edit_style, model=model, frames_dir=frames_dir, frame_names=names,
                                    source_size=(int(video["width"]), int(video["height"])),
                                    music_tracks=[p.stem for p in sfxlib.music_tracks()] if settings.get("music_enabled", True) else [])
        except ClaudeLimitError:
            raise
        except QCError as e:
            log.warning("kurgu planı alınamadı, yedek plan kullanılıyor: %s", e.message)
            raw = edit_plan.fallback(clip, esig, edit_style)
        plan = edit_plan.validate(raw, duration=length, words=words, candidates=esig["candidates"], face_ids=face_ids,
                                  edit_style=edit_style)
        if reframe == "blur":
            plan["shots"] = [{"start": 0.0, "end": length, "layout": "wide", "faces": [], "enter": "cut"}]
    on_progress("Kurgu planı", 0.36)

    # 3) hook voice-over (+ word timings for the karaoke hook)
    hook_on = bool(opts.get("hook")) and bool(sel.get("hook_text"))
    hook, tts_engine = None, None
    if hook_on:
        gender = opts.get("voice_gender", "male")
        voice = opts.get("voice") or settings.get(f"tts_voice_{gender}")
        tts_path, tts_engine = tts.synthesize(sel["hook_text"], gender, voice, work / "hook.wav",
                                              settings.get("tts_engine", "kokoro"))
        tts.trim_silence(tts_path)
        speech = tts.duration(tts_path)
        hook_dur = round(min(max(speech + 0.45, 2.5), max(6.0, speech + 0.3)), 2)
        hook_words: list[dict] = []
        try:
            hook_words = subtitles.align_text(sel["hook_text"], transcribe_short(tts_path, "small"))
        except Exception as e:
            log.warning("hook hizalama başarısız: %s", e)
        if not hook_words:
            hook_words = subtitles.proportional_words(sel["hook_text"], 0.05, speech)
        hook_words = [{"w": w["w"], "s": round(w["s"] + 0.12, 3), "e": round(w["e"] + 0.12, 3)} for w in hook_words]
        peak = float(sel.get("peak_time") or (start + end) / 2) - start
        t0 = min(max(0.0, peak - hook_dur * 0.4), max(0.0, length - hook_dur))
        hook = {"duration": hook_dur, "teaser_start": round(t0, 3), "words": hook_words, "text": sel["hook_text"],
                "tts_path": str(tts_path)}

    # 4) captions
    caption_words = None
    if opts.get("subtitles", True) and transcript.get("language", "en") != "en" and settings.get("translate_subtitles") and translate:
        try:
            caption_words = translated_words(transcript, start, end, translate)
        except ClaudeLimitError:
            raise
        except Exception as e:
            log.warning("altyazı çevirisi başarısız, orijinal dil kullanılacak: %s", e)
    cap_style_key = opts.get("subtitle_style") or settings.get("default_subtitle_style") or "yellow"
    caption_style = {"style": cap_style_key, "font": opts.get("caption_font") or settings.get("default_caption_font"),
                     "max_words": 4 if cap_style_key == "minimal" else 3}
    if opts.get("hook_same_style", True):
        hook_style = dict(caption_style)
    else:
        hook_style = {"style": opts.get("hook_subtitle_style") or settings.get("default_hook_subtitle_style") or "outline",
                      "font": opts.get("hook_font") or settings.get("default_hook_font") or "Anton"}

    person = opts.get("person") or {}
    bar = None
    if person.get("username") or opts.get("instagram"):
        bar = {"platform": person.get("platform") or "youtube", "username": person.get("username") or "",
               "instagram": (opts.get("instagram") or "").lstrip("@")}

    props, audio_plan = edit_plan.build_props(
        plan=plan, clip_len=length, words=words, tracking=tracking, timeline=timeline, src_w=pw, src_h=ph,
        margin=margin, fps=fps, width=W, height=H, hook=hook, captions_on=bool(opts.get("subtitles", True)),
        caption_style=caption_style, hook_style=hook_style, bar=bar, edit_style=edit_style,
        sfx_on=bool(settings.get("sfx_enabled", True)), sfx_volume=float(settings.get("sfx_volume") or 0.55),
        music_on=bool(settings.get("music_enabled", True)), music_volume=float(settings.get("music_volume") or 0.12),
        seed=clip["id"], media_url=proxy.name, caption_words=caption_words)
    props_path = work / "props.json"
    props_path.write_text(json.dumps(props), encoding="utf-8")

    # 5) picture (Remotion)
    t_render = time.time()
    video_only = work / "video.mp4"
    video_only.unlink(missing_ok=True)
    _remotion(props_path, video_only, work, settings,
              lambda stage, p: on_progress(stage, 0.38 + (0.04 if stage != "Render" else 0.04 + 0.48 * p)))
    log.info("remotion render %.1fs (%d kare)", time.time() - t_render, props["durationInFrames"])

    # 6) sound
    on_progress("Ses miksajı", 0.92)
    mix = audio_mix.mix(proxy=proxy, margin=margin, plan=audio_plan, out=work / "mix.wav", hook=hook)

    # 7) mux + loudness
    on_progress("Son işlemler", 0.95)
    out_dir = Path(settings.get("output_dir") or "")
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{_slug(Path(video['filename']).stem, 32)}_{clip['idx'] + 1:02d}_{clip['id']}.mp4"
    tmp_out = work / "out.mp4"
    ffmpeg.run([ffmpeg_bin(), "-y", "-v", "error", "-i", str(video_only), "-i", str(mix), "-map", "0:v", "-map", "1:a",
                "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000", "-c:a", "aac", "-b:a", "192k",
                "-ar", "48000", "-movflags", "+faststart", "-shortest", str(tmp_out)])
    final = out_dir / name
    shutil.move(str(tmp_out), final)
    total = props["durationInFrames"] / fps
    thumb = out_dir / (final.stem + ".jpg")
    try:
        ffmpeg.extract_frame(final, min((hook["duration"] if hook else 0) + 1.0, total / 2), thumb, width=540)
    except Exception:
        thumb = None
    for p in (video_only, work / "mix.wav"):
        p.unlink(missing_ok=True)
    on_progress("Bitti", 1.0)
    edl = {"plan": plan, "range": rng_key, "style": edit_style, "timeline": timeline,
           "faces": {str(k): v["summary"] for k, v in tracking.get("tracks", {}).items()},
           "output_duration": round(total, 2), "kept_duration": round(sum(e - s for s, e in audio_plan["segments"]), 2),
           "sfx": [{"t": e["t"], "type": e["type"], "file": os.path.basename(e["file"])} for e in audio_plan["sfx"]],
           "music": os.path.basename(audio_plan["music"]["file"]) if audio_plan.get("music") else None,
           "created_at": time.time()}
    return {"file_path": str(final), "thumb_path": str(thumb) if thumb else None, "duration": round(total, 2),
            "hook_duration": hook["duration"] if hook else 0.0, "tts_engine": tts_engine, "faces": len(face_ids),
            "edl": edl}
