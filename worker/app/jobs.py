"""Persistent job queue (SQLite) + pipeline orchestration.

Jobs survive restarts: anything 'running' when the worker stops is re-queued on start.
Claude usage-limit errors pause a job (resumable) instead of failing it.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import traceback
from pathlib import Path

from . import db
from .errors import ClaudeLimitError, QCError
from .pipeline import analyze, ingest, metadata, render, select, signals, transcribe
from .pipeline import ffmpeg as ff
from .pipeline.ingest import cache_dir

log = logging.getLogger("qc.jobs")
_wake = threading.Event()
_stop = threading.Event()
_thread: threading.Thread | None = None


# ------------------------------------------------------------------ queue API

def enqueue(kind: str, ref_id: str, payload: dict | None = None) -> dict:
    job = {"id": db.new_id(), "kind": kind, "ref_id": ref_id, "payload": payload or {}, "status": "queued",
           "progress": 0, "attempts": 0, "created_at": db.now(), "updated_at": db.now()}
    db.insert("jobs", job)
    _wake.set()
    return job


def retry(job_id: str) -> dict | None:
    job = db.one("SELECT * FROM jobs WHERE id=?", [job_id])
    if not job or job["status"] not in ("error", "paused"):
        return job
    db.update("jobs", job_id, status="queued", error=None, progress=0)
    _set_ref_status(job, "queued", None)
    _wake.set()
    return db.one("SELECT * FROM jobs WHERE id=?", [job_id])


def resume_paused() -> int:
    n = 0
    for job in db.query("SELECT * FROM jobs WHERE status='paused'"):
        retry(job["id"])
        n += 1
    return n


def latest_job(ref_id: str) -> dict | None:
    return db.one("SELECT * FROM jobs WHERE ref_id=? ORDER BY created_at DESC LIMIT 1", [ref_id])


def start() -> None:
    global _thread
    db.execute("UPDATE jobs SET status='queued' WHERE status='running'")
    if _thread and _thread.is_alive():
        return
    _thread = threading.Thread(target=_loop, name="qc-worker", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
    _wake.set()


def _loop() -> None:
    db.init()
    while not _stop.is_set():
        job = db.one("SELECT * FROM jobs WHERE status='queued' ORDER BY "
                     "CASE kind WHEN 'analyze' THEN 0 WHEN 'produce' THEN 1 WHEN 'metadata' THEN 2 ELSE 3 END, created_at LIMIT 1")
        if not job:
            _wake.wait(2)
            _wake.clear()
            continue
        _run(job)


def _run(job: dict) -> None:
    db.update("jobs", job["id"], status="running", attempts=job["attempts"] + 1, error=None)
    _set_ref_status(job, "running", None)
    handler = HANDLERS.get(job["kind"])
    try:
        if handler is None:
            raise QCError(f"Bilinmeyen iş türü: {job['kind']}")
        handler(job)
        db.update("jobs", job["id"], status="done", progress=1)
    except ClaudeLimitError as e:
        log.warning("Claude limiti: %s", e.message)
        db.update("jobs", job["id"], status="paused", error=e.message)
        _set_ref_status(job, "paused", e.message)
    except QCError as e:
        log.error("iş hatası %s: %s | %s", job["kind"], e.message, (e.detail or "")[-600:])
        db.update("jobs", job["id"], status="error", error=e.message)
        _set_ref_status(job, "error", e.message)
    except Exception as e:  # unexpected bug -> still a readable message
        log.error("beklenmeyen hata: %s", traceback.format_exc())
        msg = f"Beklenmeyen bir hata oluştu: {e}"[:400]
        db.update("jobs", job["id"], status="error", error=msg)
        _set_ref_status(job, "error", msg)


def _set_ref_status(job: dict, status: str, error: str | None) -> None:
    if job["kind"] in ("analyze", "produce"):
        mapping = {"running": "analyzing" if job["kind"] == "analyze" else "producing",
                   "queued": "analyzing" if job["kind"] == "analyze" else "producing",
                   "error": "error", "paused": "paused"}
        if status in mapping:
            db.update("videos", job["ref_id"], status=mapping[status], error=error)
    elif job["kind"] in ("render", "metadata"):
        if job["kind"] == "render":
            mapping = {"running": "rendering", "queued": "queued", "error": "error", "paused": "paused"}
            if status in mapping:
                db.update("clips", job["ref_id"], status=mapping[status], error=error)
        elif status in ("error", "paused"):
            db.update("clips", job["ref_id"], error=error)


def _progress(job: dict, table: str | None, stage: str, p: float) -> None:
    p = round(max(0.0, min(1.0, p)), 4)
    db.update("jobs", job["id"], stage=stage, progress=p)
    if table:
        db.update(table, job["ref_id"], stage=stage, progress=p)


# ------------------------------------------------------------------ helpers

def get_video(video_id: str) -> dict:
    v = db.one("SELECT * FROM videos WHERE id=?", [video_id])
    if not v:
        raise QCError("Video bulunamadı (silinmiş olabilir).")
    return v


def load_transcript(video: dict, settings: dict) -> dict:
    name = transcribe.resolve_model(settings["whisper_model"], settings["whisper_device"])[0]
    p = cache_dir(video["hash"]) / f"transcript_{name}.json"
    if not p.exists():  # any cached transcript is better than none
        found = sorted(cache_dir(video["hash"]).glob("transcript_*.json"))
        if not found:
            raise QCError("Transkript bulunamadı; videoyu yeniden analiz edin.")
        p = found[0]
    return json.loads(p.read_text(encoding="utf-8"))


def _signals(video: dict, transcript: dict) -> dict:
    audio = cache_dir(video["hash"]) / "audio.wav"
    return signals.compute(Path(video["path"]), audio, video["hash"], video["duration"], transcript)


def get_campaign(cid: str | None) -> dict | None:
    return db.one("SELECT * FROM campaigns WHERE id=?", [cid]) if cid else None


def effective_brief(video: dict) -> str:
    """The user's brief, or the analysis' suggested brief when the user left it empty."""
    return (video.get("brief") or "").strip() or ((video.get("analysis") or {}).get("suggested_brief") or "").strip()


def clip_person(video: dict, campaign: dict | None, opts: dict) -> dict:
    """Who goes on the bottom bar: the campaign's person, else the user's choice, else the detected creator."""
    cp = (campaign or {}).get("person") or {}
    if cp.get("username"):
        return {"platform": cp.get("platform") or "youtube", "username": cp["username"].lstrip("@"),
                "name": cp.get("name") or cp["username"], "instagram": (cp.get("instagram") or "").lstrip("@")}
    p = opts.get("person") or video.get("streamer") or {}
    return {"platform": p.get("platform") or "youtube", "username": (p.get("username") or "").lstrip("@"),
            "name": p.get("name") or "", "instagram": (p.get("instagram") or "").lstrip("@")}


def _hash(*parts) -> str:
    return hashlib.md5(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:10]


# ------------------------------------------------------------------ handlers

def handle_analyze(job: dict) -> None:
    settings = db.get_settings()
    video = get_video(job["ref_id"])
    src = Path(video["path"])
    if not src.exists():
        raise QCError("Kaynak video dosyası bulunamadı.")

    _progress(job, "videos", "Ses çıkarılıyor", 0.01)
    if not video.get("hash") or not video.get("duration"):
        info = ff.probe(src)
        if not info["has_audio"]:
            raise QCError("Videoda ses kanalı yok. Klip seçimi konuşma/ses analizi gerektirir.")
        file_hash = ingest.fingerprint(src)
        db.update("videos", video["id"], hash=file_hash, **{k: info[k] for k in ("width", "height", "fps", "duration")},
                  has_audio=int(info["has_audio"]))
        video = get_video(video["id"])
    audio = ingest.extract_audio(src, video["hash"], video["duration"],
                                 lambda p: _progress(job, "videos", "Ses çıkarılıyor", 0.01 + 0.09 * p))

    _progress(job, "videos", "Transkript", 0.1)
    transcript = transcribe.transcribe(audio, video["hash"], video["duration"], settings["whisper_model"],
                                       settings["whisper_device"],
                                       lambda p: _progress(job, "videos", "Transkript", 0.1 + 0.6 * p))

    _progress(job, "videos", "Anlar taranıyor", 0.72)
    sig = signals.compute(src, audio, video["hash"], video["duration"], transcript)

    _progress(job, "videos", "Claude analizi", 0.8)
    campaign = get_campaign(video.get("campaign_id"))
    key = _hash(video.get("brief") or "", video.get("exclude") or "", (campaign or {}).get("notes") or "",
                settings["analysis_model"])
    cached = cache_dir(video["hash"]) / f"analysis_{key}.json"
    if cached.exists() and not job["payload"].get("force"):
        result = json.loads(cached.read_text(encoding="utf-8"))
    else:
        result = analyze.run(video, transcript, sig, settings["analysis_model"], campaign)
        cached.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    result["word_count"] = sum(len(s["words"]) for s in transcript["segments"])
    result["signal_counts"] = {"energy_peaks": len(sig["energy_peaks"]), "scene_changes": len(sig["scene_changes"])}

    creator = result.get("creator") or {}
    streamer = video.get("streamer") or {}
    if not streamer.get("username"):
        streamer = {"name": creator.get("name") or "", "platform": creator.get("platform") or "youtube",
                    "username": creator.get("username") or creator.get("name") or "", "instagram": "",
                    "guessed": True}
    db.update("videos", video["id"], analysis=result, streamer=streamer, status="analyzed", stage="Hazır",
              progress=1, error=None)


def handle_produce(job: dict) -> None:
    settings = db.get_settings()
    video = get_video(job["ref_id"])
    opts = job["payload"].get("options") or {}
    analysis = video.get("analysis") or {}
    if not analysis:
        raise QCError("Önce video analizinin tamamlanması gerekiyor.")
    transcript = load_transcript(video, settings)
    sig = _signals(video, transcript)

    # brief / exclusions / campaign: the primary selection criteria
    campaign = get_campaign(opts.get("campaign_id") if "campaign_id" in opts else video.get("campaign_id"))
    brief = (opts.get("brief") if opts.get("brief") is not None else video.get("brief")) or ""
    exclude = (opts.get("exclude") if opts.get("exclude") is not None else video.get("exclude")) or ""
    db.update("videos", video["id"], brief=brief.strip(), exclude=exclude.strip(),
              campaign_id=campaign["id"] if campaign else None)
    video = get_video(video["id"])
    brief = effective_brief(video)

    duration_key = opts.get("duration", settings["default_duration"])
    max_clips = int(opts.get("max_clips", settings["default_max_clips"]))
    min_score = int(settings.get("min_viral_score", 60))
    min_rel = int(settings.get("min_relevance_score", 60))
    model = settings["analysis_model"]
    key = _hash(duration_key, max_clips, min_score, min_rel, model, brief, exclude,
                (campaign or {}).get("notes") or "", (campaign or {}).get("platforms") or [])
    sel_cache = cache_dir(video["hash"]) / f"selection_{key}.json"

    if sel_cache.exists() and not opts.get("fresh"):
        cached = json.loads(sel_cache.read_text(encoding="utf-8"))
        picks, info = cached["picks"], cached["info"]
    else:
        _progress(job, "videos", "Brief'e uygun anlar seçiliyor", 0.05)
        picks, info = select.select_clips(video, analysis, transcript, sig, duration_key=duration_key,
                                          max_clips=max_clips, min_score=min_score, model=model, brief=brief,
                                          exclude=exclude, campaign=campaign, min_relevance=min_rel)
        _progress(job, "videos", "Görsel inceleme", 0.45)
        picks = select.visual_review(video, picks, model, job["id"])
        sel_cache.write_text(json.dumps({"picks": picks, "info": info}, ensure_ascii=False), encoding="utf-8")
    analysis["brief_estimate"] = {"brief": brief, "exclude": exclude, "count": info["relevant_moment_count"],
                                  "reason": info["estimate_reason"], "source": "selection",
                                  "dropped_off_brief": info.get("dropped_off_brief", 0)}
    db.update("videos", video["id"], analysis=analysis)
    if not picks:
        raise QCError("Bu videoda brief'e uyan ve eşik skorlarını geçen güçlü bir an bulunamadı. "
                      "Brief'i genişletip veya süre hedefini değiştirip tekrar deneyin.")

    person = clip_person(video, campaign, opts)
    instagram = person.get("instagram") or ((opts.get("instagram") or "").lstrip("@") if opts.get("instagram_on") else "")
    render_opts = {
        "hook": bool(opts.get("hook", True)),
        "voice_gender": opts.get("voice_gender", settings["default_voice_gender"]),
        "voice": opts.get("voice") or None,
        "subtitles": bool(opts.get("subtitles", True)),
        "subtitle_style": opts.get("subtitle_style", settings["default_subtitle_style"]),
        "caption_font": opts.get("caption_font") or settings["default_caption_font"],
        "hook_same_style": bool(opts.get("hook_same_style", settings["default_hook_same_style"])),
        "hook_subtitle_style": opts.get("hook_subtitle_style") or settings["default_hook_subtitle_style"],
        "hook_font": opts.get("hook_font") or settings["default_hook_font"],
        "edit_style": opts.get("edit_style") or settings["default_edit_style"],
        "reframe": opts.get("reframe", settings["default_reframe"]),
        "person": {k: person[k] for k in ("platform", "username", "name")},
        "instagram": instagram,
    }
    db.update("videos", video["id"], options=opts)

    base_idx = (db.one("SELECT COALESCE(MAX(idx), -1) AS m FROM clips WHERE video_id=?", [video["id"]]) or {"m": -1})["m"] + 1
    rows = []
    for i, p in enumerate(picks):
        row = {"id": db.new_id(), "video_id": video["id"], "idx": base_idx + i, "start": p["start"], "end": p["end"],
               "score": p["score"], "selection": p, "metadata": {}, "render_opts": render_opts, "status": "queued",
               "progress": 0, "shared": {}, "campaign_id": campaign["id"] if campaign else None,
               "created_at": db.now(), "updated_at": db.now()}
        db.insert("clips", row)
        rows.append(row)

    _progress(job, "videos", "Başlık ve açıklamalar", 0.7)
    try:
        meta = metadata.generate(video, analysis, render_opts["person"] | {"instagram": instagram}, rows,
                                 settings["text_model"], campaign)
        for i, row in enumerate(rows):
            if i in meta:
                db.update("clips", row["id"], metadata=meta[i])
    except ClaudeLimitError:
        for row in rows:
            enqueue("metadata", row["id"])  # will pause on its own and resume later
    except QCError as e:
        log.warning("metadata üretilemedi: %s", e.message)
        for row in rows:
            db.update("clips", row["id"], error="Başlık/açıklama üretilemedi; 'Metinleri yeniden üret' ile tekrar deneyin.")

    for row in rows:
        enqueue("render", row["id"])
    db.update("videos", video["id"], status="ready", stage="Render kuyruğunda", progress=1, error=None)


def handle_render(job: dict) -> None:
    settings = db.get_settings()
    clip = db.one("SELECT * FROM clips WHERE id=?", [job["ref_id"]])
    if not clip:
        raise QCError("Klip bulunamadı.")
    video = get_video(clip["video_id"])
    transcript = load_transcript(video, settings)
    lang = transcript.get("language", "en")
    old_file = clip.get("file_path")

    def translate(lines: list[str]) -> list[str]:
        return metadata.translate_lines(lines, lang, settings["text_model"])

    opts = dict(clip.get("render_opts") or {})
    if not opts.get("person") and opts.get("streamer"):  # clips made before campaigns existed
        opts["person"] = opts["streamer"]
    campaign = get_campaign(clip.get("campaign_id"))
    context = {"brief": effective_brief(video), "campaign_notes": (campaign or {}).get("notes") or ""}
    result = render.render_clip(
        clip=clip, video=video, transcript=transcript, settings=settings, opts=opts,
        workdir_name=f"clip_{clip['id']}", translate=translate, context=context,
        reedit=bool(job["payload"].get("reedit")),
        on_progress=lambda stage, p: _progress(job, "clips", stage, p))
    if old_file and old_file != result["file_path"]:
        Path(old_file).unlink(missing_ok=True)
    sel = clip.get("selection") or {}
    sel["render_info"] = {k: result[k] for k in ("hook_duration", "tts_engine", "faces")}
    db.update("clips", clip["id"], status="done", stage="Hazır", progress=1, error=None, file_path=result["file_path"],
              thumb_path=result["thumb_path"], duration=result["duration"], selection=sel, edl=result["edl"])


def handle_metadata(job: dict) -> None:
    settings = db.get_settings()
    clip = db.one("SELECT * FROM clips WHERE id=?", [job["ref_id"]])
    if not clip:
        raise QCError("Klip bulunamadı.")
    video = get_video(clip["video_id"])
    ro = clip.get("render_opts") or {}
    person = ro.get("person") or ro.get("streamer") or {}
    meta = metadata.generate(video, video.get("analysis") or {}, person | {"instagram": ro.get("instagram")},
                             [clip], settings["text_model"], get_campaign(clip.get("campaign_id")))
    if 0 not in meta:
        raise QCError("Başlık ve açıklama üretilemedi.")
    db.update("clips", clip["id"], metadata=meta[0], error=None if clip["status"] != "error" else clip["error"])


HANDLERS = {
    "analyze": handle_analyze,
    "produce": handle_produce,
    "render": handle_render,
    "metadata": handle_metadata,
}


def wait_idle(timeout: float = 3600) -> bool:
    """Test helper: block until no queued/running jobs remain."""
    end = time.time() + timeout
    while time.time() < end:
        if not db.one("SELECT id FROM jobs WHERE status IN ('queued','running') LIMIT 1"):
            return True
        time.sleep(1)
    return False
