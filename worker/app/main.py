"""QuillClips worker API (FastAPI). Runs the job queue in a background thread."""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from . import claude_cli, db, jobs, providers
from .config import (EDIT_STYLES, FONTS, KOKORO_VOICES, PLATFORMS, SHARE_PLATFORMS, SUBTITLE_STYLES, UPLOADS_DIR,
                     WORK_DIR, YOUTUBE_CATEGORIES)
from .errors import ClaudeLimitError, QCError
from .pipeline import analyze as analyze_mod
from .pipeline import edit_plan
from .pipeline import ffmpeg as ff
from .pipeline import metadata as meta_mod
from .pipeline import select as select_mod
from .pipeline import sfx as sfx_mod
from .pipeline.ingest import cache_dir

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
for _noisy in ("httpx", "huggingface_hub", "faster_whisper"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv", ".wmv", ".mpg", ".mpeg", ".ts", ".mts",
              ".m2ts", ".3gp", ".ogv", ".vob", ".f4v", ".asf", ".mxf", ".divx"}
WHISPER_MODELS = ["auto", "tiny", "base", "small", "medium", "large-v3-turbo", "large-v3", "distil-large-v3"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    jobs.start()
    yield
    jobs.stop()


app = FastAPI(title="QuillClips Worker", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail=msg)


# ------------------------------------------------------------------ serialization

_campaign_names: dict[str, str] = {}


def _campaign_name(cid: str | None) -> str | None:
    if not cid:
        return None
    if cid not in _campaign_names:
        row = db.one("SELECT name FROM campaigns WHERE id=?", [cid])
        if not row:
            return None
        _campaign_names[cid] = row["name"]
    return _campaign_names[cid]


def clip_out(c: dict, video: dict | None = None) -> dict:
    sel = c.get("selection") or {}
    ro = c.get("render_opts") or {}
    v = video or db.one("SELECT id, filename, analysis, created_at FROM videos WHERE id=?", [c["video_id"]]) or {}
    analysis = v.get("analysis") or {}
    edl = c.get("edl") or {}
    plan = edl.get("plan") or {}
    return {
        "id": c["id"], "video_id": c["video_id"], "video_filename": v.get("filename"), "idx": c["idx"],
        "start": c["start"], "end": c["end"], "score": c["score"], "status": c["status"], "stage": c.get("stage"),
        "progress": c.get("progress") or 0, "error": c.get("error"), "duration": c.get("duration"),
        "why_viral": sel.get("why_viral"), "tags": sel.get("tags", []), "scores": sel.get("scores", {}),
        "relevance_score": sel.get("relevance_score"), "relevance_reason": sel.get("relevance_reason"),
        "hook_text": sel.get("hook_text"), "summary": sel.get("summary"), "text": sel.get("text"),
        "visual": sel.get("visual"), "render_info": sel.get("render_info"),
        "metadata": c.get("metadata") or {}, "render_opts": ro, "shared": c.get("shared") or {},
        "category": analysis.get("primary_category"), "person": (ro.get("person") or ro.get("streamer") or {}),
        "campaign_id": c.get("campaign_id"), "campaign_name": _campaign_name(c.get("campaign_id")),
        "edit": {"summary": plan.get("summary"), "style": edl.get("style"), "grade": plan.get("grade"),
                 "fallback": plan.get("fallback", False)} if plan else None,
        "created_at": c["created_at"], "updated_at": c["updated_at"],
        "file_url": f"/api/clips/{c['id']}/file?v={int(c['updated_at'])}" if c.get("file_path") else None,
        "thumb_url": f"/api/clips/{c['id']}/thumb?v={int(c['updated_at'])}" if c.get("thumb_path") else None,
    }


def video_out(v: dict, with_clips: bool = False) -> dict:
    out = {k: v.get(k) for k in ("id", "filename", "size", "duration", "width", "height", "fps", "status", "stage",
                                 "progress", "error", "analysis", "streamer", "options", "brief", "exclude",
                                 "campaign_id", "created_at", "updated_at")}
    out["effective_brief"] = jobs.effective_brief(v)
    counts = db.one("SELECT COUNT(*) AS n, SUM(status='done') AS done FROM clips WHERE video_id=?", [v["id"]]) or {}
    out["clip_count"] = counts.get("n") or 0
    out["clips_done"] = counts.get("done") or 0
    if out["status"] == "ready" and out["clip_count"] and out["clips_done"] == out["clip_count"]:
        out["stage"] = "Klipler hazır"
    out["poster_url"] = f"/api/videos/{v['id']}/poster" if v.get("hash") else None
    job = jobs.latest_job(v["id"])
    out["job"] = {k: job[k] for k in ("id", "kind", "status", "stage", "progress", "error")} if job else None
    if with_clips:
        out["clips"] = [clip_out(c, v) for c in db.query("SELECT * FROM clips WHERE video_id=? ORDER BY score DESC, idx", [v["id"]])]
    return out


# ------------------------------------------------------------------ health / dashboard

@app.get("/api/health")
def health():
    return {"ok": True, "time": time.time()}


@app.get("/api/dashboard")
def dashboard():
    week = time.time() - 7 * 86400
    total = db.one("SELECT COUNT(*) AS n FROM clips WHERE status='done'")["n"]
    this_week = db.one("SELECT COUNT(*) AS n FROM clips WHERE status='done' AND created_at>=?", [week])["n"]
    done = db.query("SELECT shared FROM clips WHERE status='done'")
    pending = sum(1 for c in done if not any((c.get("shared") or {}).get(p) for p in ("youtube", "tiktok", "instagram")))
    rendering = db.one("SELECT COUNT(*) AS n FROM clips WHERE status IN ('queued','rendering')")["n"]
    daily = []
    for i in range(6, -1, -1):
        day_start = time.mktime(time.localtime(time.time() - i * 86400)[:3] + (0, 0, 0, 0, 0, -1))
        n = db.one("SELECT COUNT(*) AS n FROM clips WHERE created_at>=? AND created_at<?", [day_start, day_start + 86400])["n"]
        daily.append(n)
    recent = [video_out(v) for v in db.query("SELECT * FROM videos ORDER BY created_at DESC LIMIT 5")]
    top = db.query("SELECT * FROM clips WHERE status='done' ORDER BY score DESC LIMIT 1")
    return {"clips_total": total, "clips_this_week": this_week, "pending_share": pending, "rendering": rendering,
            "daily": daily, "recent_videos": recent, "top_clip": clip_out(top[0]) if top else None,
            "paused_jobs": db.one("SELECT COUNT(*) AS n FROM jobs WHERE status='paused'")["n"],
            "earnings": earnings()}


def earnings() -> dict:
    """Estimated earnings per campaign = views x CPM / 1000.

    View counts need platform analytics (providers.py placeholders); until those exist `views` is None and the
    UI shows the structure with placeholders. Shared clip counts are real.
    """
    rows = []
    for camp in db.query("SELECT * FROM campaigns ORDER BY created_at DESC"):
        clips = db.query("SELECT shared, status FROM clips WHERE campaign_id=?", [camp["id"]])
        shared = sum(1 for c in clips if any((c.get("shared") or {}).get(p) for p in SHARE_PLATFORMS))
        views = providers.campaign_views(camp["id"])  # None until analytics are connected
        rows.append({"id": camp["id"], "name": camp["name"], "cpm": camp["cpm"], "platforms": camp["platforms"],
                     "clips": len(clips), "clips_done": sum(1 for c in clips if c["status"] == "done"),
                     "shared": shared, "views": views,
                     "estimated": round(views * camp["cpm"] / 1000, 2) if views is not None else None})
    known = [r["estimated"] for r in rows if r["estimated"] is not None]
    return {"campaigns": rows, "total": round(sum(known), 2) if known else None, "analytics_connected": bool(known)}


@app.get("/api/platforms")
def platforms():
    return providers.all_stats()


# ------------------------------------------------------------------ uploads (chunked)

class UploadInit(BaseModel):
    filename: str
    size: int


@app.post("/api/uploads")
def upload_init(body: UploadInit):
    ext = Path(body.filename).suffix.lower()
    if ext not in VIDEO_EXTS:
        _err(400, f"Desteklenmeyen dosya türü: {ext or 'uzantısız'}. Bir video dosyası yükleyin.")
    uid = db.new_id()
    part = UPLOADS_DIR / f"{uid}{ext}.part"
    part.touch()
    return {"upload_id": uid, "path": part.name, "received": 0}


def _part(uid: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{12}", uid):
        _err(400, "Geçersiz yükleme kimliği")
    found = list(UPLOADS_DIR.glob(f"{uid}.*.part"))
    if not found:
        _err(404, "Yükleme bulunamadı")
    return found[0]


@app.put("/api/uploads/{uid}")
async def upload_chunk(uid: str, request: Request, offset: int = 0):
    part = _part(uid)
    size = part.stat().st_size
    if offset != size:
        return {"received": size, "resync": True}
    with open(part, "ab") as f:
        async for chunk in request.stream():
            f.write(chunk)
    return {"received": part.stat().st_size}


class UploadDone(BaseModel):
    filename: str
    brief: str | None = ""
    exclude: str | None = ""
    campaign_id: str | None = None


@app.post("/api/uploads/{uid}/complete")
def upload_complete(uid: str, body: UploadDone):
    part = _part(uid)
    final = part.with_suffix("")
    part.replace(final)
    try:
        info = ff.probe(final)
    except QCError as e:
        final.unlink(missing_ok=True)
        _err(400, e.message)
    if not info["has_audio"]:
        final.unlink(missing_ok=True)
        _err(400, "Videoda ses kanalı yok. QuillClips konuşma içeren videolar için tasarlandı.")
    campaign_id = body.campaign_id if body.campaign_id and jobs.get_campaign(body.campaign_id) else None
    vid = uid
    db.insert("videos", {"id": vid, "filename": body.filename, "path": str(final), "size": final.stat().st_size,
                         "duration": info["duration"], "width": info["width"], "height": info["height"], "fps": info["fps"],
                         "has_audio": 1, "status": "analyzing", "stage": "Sırada", "progress": 0, "streamer": {},
                         "brief": (body.brief or "").strip()[:2000], "exclude": (body.exclude or "").strip()[:1000],
                         "campaign_id": campaign_id, "created_at": db.now(), "updated_at": db.now()})
    jobs.enqueue("analyze", vid)
    return video_out(db.one("SELECT * FROM videos WHERE id=?", [vid]))


# ------------------------------------------------------------------ videos

@app.get("/api/videos")
def list_videos():
    return [video_out(v) for v in db.query("SELECT * FROM videos ORDER BY created_at DESC")]


def _video(vid: str) -> dict:
    v = db.one("SELECT * FROM videos WHERE id=?", [vid])
    if not v:
        _err(404, "Video bulunamadı")
    return v


@app.get("/api/videos/{vid}")
def get_video(vid: str):
    return video_out(_video(vid), with_clips=True)


@app.get("/api/videos/{vid}/poster")
def video_poster(vid: str):
    v = _video(vid)
    frames = sorted((cache_dir(v["hash"]) / "overview_frames").glob("*.jpg")) if v.get("hash") else []
    if frames:
        return FileResponse(frames[min(1, len(frames) - 1)])
    p = cache_dir(v["hash"]) / "poster.jpg"
    if not p.exists():
        ff.extract_frame(Path(v["path"]), min(5.0, (v.get("duration") or 10) / 3), p, width=640)
    return FileResponse(p)


class VideoPatch(BaseModel):
    streamer: dict | None = None
    analysis: dict | None = None
    brief: str | None = None
    exclude: str | None = None
    campaign_id: str | None = None


@app.patch("/api/videos/{vid}")
def patch_video(vid: str, body: VideoPatch):
    v = _video(vid)
    fields: dict = {}
    if body.streamer is not None:
        fields["streamer"] = {**(v.get("streamer") or {}), **body.streamer, "guessed": False}
    if body.analysis is not None:
        fields["analysis"] = {**(v.get("analysis") or {}), **body.analysis}
    if body.brief is not None:
        fields["brief"] = body.brief.strip()[:2000]
    if body.exclude is not None:
        fields["exclude"] = body.exclude.strip()[:1000]
    if body.campaign_id is not None:
        fields["campaign_id"] = body.campaign_id if body.campaign_id and jobs.get_campaign(body.campaign_id) else None
    if fields:
        db.update("videos", vid, **fields)
    return video_out(_video(vid), with_clips=True)


class EstimateBody(BaseModel):
    brief: str
    exclude: str | None = ""


@app.post("/api/videos/{vid}/estimate")
async def estimate_clips(vid: str, body: EstimateBody):
    """Re-count how many strong clips fit an edited brief (Sonnet over the transcript)."""
    v = _video(vid)
    if not v.get("analysis"):
        _err(409, "Analiz henüz tamamlanmadı.")
    s = db.get_settings()
    try:
        transcript = jobs.load_transcript(v, s)
        est = await run_in_threadpool(analyze_mod.estimate, v, v["analysis"], transcript, body.brief.strip(),
                                      (body.exclude or "").strip(), s["text_model"])
    except ClaudeLimitError as e:
        _err(429, e.message)
    except QCError as e:
        _err(502, e.message)
    analysis = {**v["analysis"], "brief_estimate": {**est, "source": "estimate"}}
    db.update("videos", vid, analysis=analysis, brief=body.brief.strip()[:2000], exclude=(body.exclude or "").strip()[:1000])
    return video_out(_video(vid), with_clips=True)


@app.delete("/api/videos/{vid}")
def delete_video(vid: str):
    v = _video(vid)
    for c in db.query("SELECT file_path, thumb_path FROM clips WHERE video_id=?", [vid]):
        for p in (c.get("file_path"), c.get("thumb_path")):
            if p:
                Path(p).unlink(missing_ok=True)
    db.execute("DELETE FROM jobs WHERE ref_id=? OR ref_id IN (SELECT id FROM clips WHERE video_id=?)", [vid, vid])
    db.execute("DELETE FROM clips WHERE video_id=?", [vid])
    db.execute("DELETE FROM videos WHERE id=?", [vid])
    Path(v["path"]).unlink(missing_ok=True)
    return {"ok": True}


class ProduceBody(BaseModel):
    options: dict


@app.post("/api/videos/{vid}/produce")
def produce(vid: str, body: ProduceBody):
    v = _video(vid)
    if not v.get("analysis"):
        _err(409, "Analiz henüz tamamlanmadı.")
    active = db.one("SELECT id FROM jobs WHERE ref_id=? AND kind='produce' AND status IN ('queued','running')", [vid])
    if active:
        _err(409, "Bu video için üretim zaten sürüyor.")
    jobs.enqueue("produce", vid, {"options": body.options})
    db.update("videos", vid, status="producing", stage="Sırada", progress=0, error=None)
    return video_out(_video(vid), with_clips=True)


@app.post("/api/videos/{vid}/retry")
def retry_video(vid: str):
    _video(vid)
    job = db.one("SELECT * FROM jobs WHERE ref_id=? AND status IN ('error','paused') ORDER BY created_at DESC LIMIT 1", [vid])
    if not job:
        _err(404, "Tekrar denenecek başarısız bir iş yok.")
    jobs.retry(job["id"])
    return video_out(_video(vid), with_clips=True)


@app.post("/api/videos/{vid}/reanalyze")
def reanalyze(vid: str):
    v = _video(vid)
    if v.get("hash"):
        for p in cache_dir(v["hash"]).glob("analysis*.json"):
            p.unlink(missing_ok=True)
    jobs.enqueue("analyze", vid, {"force": True})
    db.update("videos", vid, status="analyzing", stage="Sırada", progress=0, error=None)
    return video_out(_video(vid), with_clips=True)


# ------------------------------------------------------------------ clips

@app.get("/api/clips")
def list_clips(video_id: str | None = None, status: str | None = None, min_score: int | None = None,
               category: str | None = None, campaign_id: str | None = None, q: str | None = None,
               since: float | None = None, shared: str | None = None):
    sql = "SELECT c.*, v.filename AS v_filename, v.analysis AS v_analysis FROM clips c JOIN videos v ON v.id=c.video_id WHERE 1=1"
    params: list = []
    if video_id:
        sql += " AND c.video_id=?"
        params.append(video_id)
    if campaign_id == "none":
        sql += " AND c.campaign_id IS NULL"
    elif campaign_id:
        sql += " AND c.campaign_id=?"
        params.append(campaign_id)
    if status:
        sql += " AND c.status=?"
        params.append(status)
    if min_score is not None:
        sql += " AND c.score>=?"
        params.append(min_score)
    if since:
        sql += " AND c.created_at>=?"
        params.append(since)
    sql += " ORDER BY c.created_at DESC, c.score DESC"
    out = []
    for c in db.query(sql, params):
        v = {"id": c["video_id"], "filename": c.pop("v_filename"), "analysis": c.pop("v_analysis")}
        if isinstance(v["analysis"], str):
            try:
                v["analysis"] = json.loads(v["analysis"])
            except ValueError:
                v["analysis"] = {}
        item = clip_out(c, v)
        if category and item["category"] != category:
            continue
        if shared == "none" and any(item["shared"].get(p) for p in ("youtube", "tiktok", "instagram")):
            continue
        if shared in ("youtube", "tiktok", "instagram") and not item["shared"].get(shared):
            continue
        if q:
            hay = " ".join(str(x) for x in (item["metadata"].get("youtube_title"), item["summary"], item["hook_text"],
                                            item["video_filename"], item["text"], item["person"].get("username"),
                                            item["campaign_name"])).lower()
            if q.lower() not in hay:
                continue
        out.append(item)
    return out


def _clip(cid: str) -> dict:
    c = db.one("SELECT * FROM clips WHERE id=?", [cid])
    if not c:
        _err(404, "Klip bulunamadı")
    return c


@app.get("/api/clips/{cid}")
def get_clip(cid: str):
    return clip_out(_clip(cid))


class ClipPatch(BaseModel):
    shared: dict | None = None
    metadata: dict | None = None


@app.patch("/api/clips/{cid}")
def patch_clip(cid: str, body: ClipPatch):
    c = _clip(cid)
    fields = {}
    if body.shared is not None:
        shared = dict(c.get("shared") or {})
        for k, val in body.shared.items():
            if k in ("youtube", "tiktok", "instagram"):
                shared[k] = (val if isinstance(val, (int, float)) else time.time()) if val else None
        fields["shared"] = shared
    if body.metadata is not None:
        fields["metadata"] = {**(c.get("metadata") or {}), **body.metadata}
    db.update("clips", cid, **fields)
    return clip_out(_clip(cid))


@app.delete("/api/clips/{cid}")
def delete_clip(cid: str):
    c = _clip(cid)
    for p in (c.get("file_path"), c.get("thumb_path")):
        if p:
            Path(p).unlink(missing_ok=True)
    db.execute("DELETE FROM jobs WHERE ref_id=?", [cid])
    db.execute("DELETE FROM clips WHERE id=?", [cid])
    return {"ok": True}


class AdjustBody(BaseModel):
    start_delta: float = 0
    end_delta: float = 0
    render_opts: dict | None = None


@app.post("/api/clips/{cid}/rerender")
def rerender(cid: str, body: AdjustBody):
    c = _clip(cid)
    v = _video(c["video_id"])
    if db.one("SELECT id FROM jobs WHERE ref_id=? AND kind='render' AND status IN ('queued','running')", [cid]):
        _err(409, "Bu klip zaten render ediliyor.")
    start, end = float(c["start"]), float(c["end"])
    if body.start_delta or body.end_delta:
        ns = max(0.0, start + body.start_delta)
        ne = min(float(v["duration"]), end + body.end_delta)
        if ne - ns < 3:
            _err(400, "Klip 3 saniyeden kısa olamaz.")
        transcript = jobs.load_transcript(v, db.get_settings())
        start, end = select_mod.resnap(transcript, ns, ne)
        sel = c.get("selection") or {}
        from .pipeline.textfmt import clip_text
        sel["text"] = clip_text(transcript, start, end)
        if not (start <= float(sel.get("peak_time") or start) <= end):
            sel["peak_time"] = (start + end) / 2
        db.update("clips", cid, start=start, end=end, selection=sel)
    if body.render_opts:
        db.update("clips", cid, render_opts={**(c.get("render_opts") or {}), **body.render_opts})
    db.update("clips", cid, status="queued", stage="Sırada", progress=0, error=None)
    jobs.enqueue("render", cid)
    return clip_out(_clip(cid))


class ReeditBody(BaseModel):
    edit_style: str | None = None


@app.post("/api/clips/{cid}/reedit")
def reedit(cid: str, body: ReeditBody):
    """Ask Opus for a fresh edit plan (EDL) and re-render; speaker analysis stays cached."""
    c = _clip(cid)
    if db.one("SELECT id FROM jobs WHERE ref_id=? AND kind='render' AND status IN ('queued','running')", [cid]):
        _err(409, "Bu klip zaten render ediliyor.")
    if body.edit_style:
        if body.edit_style not in EDIT_STYLES:
            _err(400, "Geçersiz kurgu stili")
        db.update("clips", cid, render_opts={**(c.get("render_opts") or {}), "edit_style": body.edit_style})
    db.update("clips", cid, status="queued", stage="Sırada", progress=0, error=None)
    jobs.enqueue("render", cid, {"reedit": True})
    return clip_out(_clip(cid))


@app.get("/api/clips/{cid}/edl")
def clip_edl(cid: str):
    """Readable edit timeline for the 'Kurgu planını göster' panel."""
    c = _clip(cid)
    edl = c.get("edl") or {}
    plan = edl.get("plan")
    if not plan:
        _err(404, "Bu klip için henüz bir kurgu planı yok.")
    return {"summary": plan.get("summary"), "style": edl.get("style"), "grade": plan.get("grade"),
            "fallback": plan.get("fallback", False), "clip_duration": round(float(c["end"]) - float(c["start"]), 2),
            "kept_duration": edl.get("kept_duration"), "output_duration": edl.get("output_duration"),
            "speakers": edl.get("timeline") or [], "faces": edl.get("faces") or {}, "music": edl.get("music"),
            "progress_bar": plan.get("progress_bar"), "events": edit_plan.readable(plan),
            "sfx_files": edl.get("sfx") or []}


@app.post("/api/clips/{cid}/retry")
def retry_clip(cid: str):
    _clip(cid)
    job = db.one("SELECT * FROM jobs WHERE ref_id=? AND status IN ('error','paused') ORDER BY created_at DESC LIMIT 1", [cid])
    if not job:
        _err(404, "Tekrar denenecek başarısız bir iş yok.")
    jobs.retry(job["id"])
    return clip_out(_clip(cid))


@app.post("/api/clips/{cid}/metadata")
def regen_metadata(cid: str):
    _clip(cid)
    jobs.enqueue("metadata", cid)
    return {"ok": True}


@app.post("/api/clips/{cid}/titles")
async def title_alternatives(cid: str):
    c = _clip(cid)
    v = _video(c["video_id"])
    ro = c.get("render_opts") or {}
    try:
        titles = await run_in_threadpool(meta_mod.title_alternatives, v, v.get("analysis") or {},
                                         (ro.get("person") or ro.get("streamer") or {}) | {"instagram": ro.get("instagram")},
                                         c, db.get_settings()["text_model"], jobs.get_campaign(c.get("campaign_id")))
    except ClaudeLimitError as e:
        _err(429, e.message)
    except QCError as e:
        _err(502, e.message)
    return {"titles": titles}


def _safe_file(p: str | None) -> Path:
    if not p or not Path(p).exists():
        _err(404, "Dosya bulunamadı")
    return Path(p)


@app.get("/api/clips/{cid}/file")
def clip_file(cid: str, download: int = 0):
    c = _clip(cid)
    path = _safe_file(c.get("file_path"))
    if download:
        return FileResponse(path, media_type="video/mp4", filename=path.name)
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/clips/{cid}/thumb")
def clip_thumb(cid: str):
    return FileResponse(_safe_file(_clip(cid).get("thumb_path")), media_type="image/jpeg")


class ZipBody(BaseModel):
    ids: list[str]


@app.post("/api/clips/zip")
def clips_zip(body: ZipBody):
    files = []
    for cid in body.ids:
        c = db.one("SELECT file_path FROM clips WHERE id=?", [cid])
        if c and c.get("file_path") and Path(c["file_path"]).exists():
            files.append(Path(c["file_path"]))
    if not files:
        _err(404, "İndirilecek hazır klip yok.")
    fd, tmp = tempfile.mkstemp(suffix=".zip", dir=WORK_DIR)
    os.close(fd)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
        for f in files:
            z.write(f, f.name)
    return FileResponse(tmp, media_type="application/zip", filename=f"quillclips_{len(files)}_klip.zip",
                        background=BackgroundTask(lambda: Path(tmp).unlink(missing_ok=True)))


# ------------------------------------------------------------------ campaigns

class CampaignPerson(BaseModel):
    platform: str | None = None
    username: str | None = ""
    instagram: str | None = ""


class CampaignBody(BaseModel):
    name: str
    url: str
    cpm: float
    platforms: list[str]
    drive_url: str | None = ""
    person: CampaignPerson | None = None
    notes: str | None = ""


URL_RE = re.compile(r"^https?://\S+$", re.I)


def _campaign_row(body: CampaignBody) -> dict:
    name, url = body.name.strip(), body.url.strip()
    if not name:
        _err(400, "Kampanya adı zorunlu.")
    if not URL_RE.match(url):
        _err(400, "Geçerli bir Whop Content Rewards linki girin (https://...).")
    if not (body.cpm > 0) or body.cpm > 10000:
        _err(400, "CPM 0'dan büyük bir sayı olmalı ($ / 1000 görüntülenme).")
    plats = [p for p in dict.fromkeys(body.platforms) if p in SHARE_PLATFORMS]
    if not plats:
        _err(400, "En az bir geçerli platform seçin (YouTube, TikTok, Instagram).")
    drive = (body.drive_url or "").strip()
    if drive and not URL_RE.match(drive):
        _err(400, "Google Drive linki geçerli bir URL olmalı.")
    person = {}
    if body.person and (body.person.username or "").strip():
        if body.person.platform not in PLATFORMS:
            _err(400, "Kişi için geçerli bir platform seçin.")
        person = {"platform": body.person.platform, "username": body.person.username.strip().lstrip("@"),
                  "instagram": (body.person.instagram or "").strip().lstrip("@")}
    return {"name": name[:120], "url": url, "cpm": round(float(body.cpm), 4), "platforms": plats, "drive_url": drive,
            "person": person, "notes": (body.notes or "").strip()[:4000]}


def campaign_out(row: dict) -> dict:
    counts = db.one("SELECT COUNT(*) AS n, SUM(status='done') AS done FROM clips WHERE campaign_id=?", [row["id"]]) or {}
    return {**row, "clip_count": counts.get("n") or 0, "clips_done": counts.get("done") or 0,
            "video_count": db.one("SELECT COUNT(*) AS n FROM videos WHERE campaign_id=?", [row["id"]])["n"]}


@app.get("/api/campaigns")
def list_campaigns():
    return [campaign_out(r) for r in db.query("SELECT * FROM campaigns ORDER BY created_at DESC")]


@app.post("/api/campaigns")
def create_campaign(body: CampaignBody):
    row = {"id": db.new_id(), **_campaign_row(body), "created_at": db.now(), "updated_at": db.now()}
    db.insert("campaigns", row)
    return campaign_out(db.one("SELECT * FROM campaigns WHERE id=?", [row["id"]]))


@app.put("/api/campaigns/{cid}")
def update_campaign(cid: str, body: CampaignBody):
    if not jobs.get_campaign(cid):
        _err(404, "Kampanya bulunamadı")
    db.update("campaigns", cid, **_campaign_row(body))
    _campaign_names.pop(cid, None)
    return campaign_out(db.one("SELECT * FROM campaigns WHERE id=?", [cid]))


@app.delete("/api/campaigns/{cid}")
def delete_campaign(cid: str):
    # clips and videos stay; they just lose the campaign link
    db.execute("UPDATE clips SET campaign_id=NULL WHERE campaign_id=?", [cid])
    db.execute("UPDATE videos SET campaign_id=NULL WHERE campaign_id=?", [cid])
    db.execute("DELETE FROM campaigns WHERE id=?", [cid])
    _campaign_names.pop(cid, None)
    return {"ok": True}


@app.get("/api/earnings")
def get_earnings():
    return earnings()


# ------------------------------------------------------------------ settings / claude

@app.get("/api/settings")
def get_settings():
    return db.get_settings()


@app.put("/api/settings")
def put_settings(body: dict):
    if "output_dir" in body and body["output_dir"]:
        try:
            Path(body["output_dir"]).mkdir(parents=True, exist_ok=True)
        except OSError:
            _err(400, "Çıktı klasörü oluşturulamadı")
    return db.save_settings(body)


@app.get("/api/options")
def options():
    from .pipeline.transcribe import cuda_available
    return {"categories": YOUTUBE_CATEGORIES, "platforms": PLATFORMS, "share_platforms": SHARE_PLATFORMS,
            "voices": KOKORO_VOICES, "subtitle_styles": SUBTITLE_STYLES, "fonts": list(FONTS),
            "edit_styles": EDIT_STYLES, "whisper_models": WHISPER_MODELS, "cuda": cuda_available(),
            "sfx": sfx_mod.library_summary()}


@app.get("/api/claude/status")
async def claude_status():
    return await run_in_threadpool(claude_cli.status)


@app.post("/api/claude/test")
async def claude_test():
    s = db.get_settings()
    t0 = time.time()
    try:
        r = await run_in_threadpool(claude_cli.call, "Reply with exactly: OK", model=s["text_model"],
                                    system="You are a health check.", purpose="health_check", retries=0)
    except QCError as e:
        return {"ok": False, "error": e.message, "detail": e.detail}
    return {"ok": True, "reply": str(r)[:50], "ms": int((time.time() - t0) * 1000)}


@app.get("/api/claude/logs")
def claude_logs(limit: int = 50):
    return db.query("SELECT * FROM claude_logs ORDER BY id DESC LIMIT ?", [min(500, limit)])


@app.get("/api/jobs")
def list_jobs(active: int = 0):
    sql = "SELECT * FROM jobs"
    if active:
        sql += " WHERE status IN ('queued','running','paused','error')"
    return db.query(sql + " ORDER BY created_at DESC LIMIT 100")


@app.post("/api/jobs/resume")
def resume_jobs():
    return {"resumed": jobs.resume_paused()}


@app.post("/api/jobs/{jid}/retry")
def retry_job(jid: str):
    j = jobs.retry(jid)
    if not j:
        _err(404, "İş bulunamadı")
    return j


@app.get("/api/tts/preview")
def tts_preview(gender: str = "male", voice: str | None = None):
    from .pipeline import tts
    s = db.get_settings()
    voice = voice or s.get(f"tts_voice_{gender}")
    out = WORK_DIR / "tts_preview" / f"{gender}_{voice}_{s.get('tts_engine')}.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        try:
            tts.synthesize("He thought it was a normal stream. Then this happened.", gender, voice, out,
                           s.get("tts_engine", "kokoro"))
        except QCError as e:
            _err(500, e.message)
    return FileResponse(out, media_type="audio/wav")
