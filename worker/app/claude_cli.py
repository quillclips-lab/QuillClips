"""All LLM calls go through the Claude Code CLI in headless mode (`claude -p`).

No API key is ever used: ANTHROPIC_API_KEY (and friends) are removed from the
child environment so the CLI falls back to the logged-in subscription.
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
from typing import Any

from . import db
from .config import CACHE_DIR, PROMPTS_DIR
from .errors import ClaudeAuthError, ClaudeLimitError, QCError

log = logging.getLogger("qc.claude")

STRIP_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX")

LIMIT_PATTERNS = re.compile(
    r"usage limit|rate.?limit|limit reached|hit your limit|5-hour limit|weekly limit|out of (extra )?usage|"
    r"too many requests|\b429\b|quota",
    re.I,
)
AUTH_PATTERNS = re.compile(r"not logged in|please run /login|invalid api key|authentication|unauthorized|\b401\b|oauth", re.I)

_EMPTY_CWD = CACHE_DIR / "claude_cwd"


def claude_exe() -> str:
    custom = db.get_settings().get("claude_path") or ""
    if custom and Path(custom).exists():
        return custom
    found = shutil.which("claude")
    if found:
        return found
    for cand in (Path.home() / ".local/bin/claude.exe", Path.home() / ".local/bin/claude",
                 Path.home() / ".claude/local/claude"):
        if cand.exists():
            return str(cand)
    raise QCError("Claude Code CLI bulunamadı. 'claude' komutunun kurulu ve PATH'te olduğundan emin olun.")


def child_env() -> dict:
    env = dict(os.environ)
    for k in STRIP_ENV:
        env.pop(k, None)
    env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
    return env


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")


def _log(model: str, purpose: str, started: float, ok: bool, error: str | None, cost: float | None,
         prompt_chars: int, preview: str | None) -> None:
    try:
        db.execute(
            "INSERT INTO claude_logs(ts, model, purpose, duration_ms, ok, error, cost_usd, prompt_chars, preview) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (time.time(), model, purpose, int((time.time() - started) * 1000), int(ok), error, cost, prompt_chars,
             (preview or "")[:600]),
        )
    except Exception:  # logging must never break a job
        log.exception("claude log yazılamadı")


def _extract_json(text: str) -> Any:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=-1)
        if start < 0:
            raise
        end = max(text.rfind("}"), text.rfind("]"))
        return json.loads(text[start:end + 1])


def _check_required(data: Any, schema: dict) -> None:
    if not isinstance(data, dict):
        raise ValueError("çıktı bir JSON nesnesi değil")
    missing = [k for k in schema.get("required", []) if k not in data]
    if missing:
        raise ValueError(f"eksik alanlar: {', '.join(missing)}")


_UNSUPPORTED_SCHEMA_KEYS = {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength",
                            "maxItems", "minItems", "pattern"}


def _portable_schema(schema: Any) -> Any:
    """Drop numeric/length constraints that structured outputs may reject; we validate those ourselves."""
    if isinstance(schema, dict):
        return {k: _portable_schema(v) for k, v in schema.items() if k not in _UNSUPPORTED_SCHEMA_KEYS}
    if isinstance(schema, list):
        return [_portable_schema(v) for v in schema]
    return schema


def _run_once(prompt: str, *, model: str, system: str, schema: dict | None, image_dir: Path | None,
              timeout: int) -> dict:
    cmd = [claude_exe(), "-p", "--output-format", "json", "--model", model,
           "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands",
           "--setting-sources", "project", "--system-prompt", system]
    if schema:
        cmd += ["--json-schema", json.dumps(_portable_schema(schema))]
    if image_dir:
        cmd += ["--tools", "Read", "--allowedTools", "Read"]
        cwd = image_dir
    else:
        cmd += ["--tools", ""]
        _EMPTY_CWD.mkdir(parents=True, exist_ok=True)
        cwd = _EMPTY_CWD
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           env=child_env(), cwd=str(cwd), timeout=timeout, creationflags=flags)
    except subprocess.TimeoutExpired:
        raise TimeoutError(f"Claude {timeout} sn içinde yanıt vermedi")
    out = (p.stdout or "").strip()
    err = (p.stderr or "").strip()
    try:
        res = json.loads(out.splitlines()[-1] if out and not out.startswith("{") else out)
    except (json.JSONDecodeError, IndexError):
        blob = f"{out}\n{err}"
        if LIMIT_PATTERNS.search(blob):
            raise ClaudeLimitError(_limit_message(blob), blob[-800:])
        if AUTH_PATTERNS.search(blob):
            raise ClaudeAuthError("Claude CLI oturumu açık değil. Terminalde `claude` çalıştırıp giriş yapın.", blob[-800:])
        raise RuntimeError(f"Claude CLI beklenmeyen çıktı verdi (kod {p.returncode}): {blob[-400:]}")
    if res.get("is_error") or res.get("subtype") not in (None, "success"):
        msg = str(res.get("result") or res.get("subtype") or err)
        status = res.get("api_error_status")
        if status == 429 or LIMIT_PATTERNS.search(msg):
            raise ClaudeLimitError(_limit_message(msg), msg)
        if status == 401 or AUTH_PATTERNS.search(msg):
            raise ClaudeAuthError("Claude CLI oturumu açık değil. Terminalde `claude` çalıştırıp giriş yapın.", msg)
        raise RuntimeError(f"Claude hatası: {msg[:400]}")
    return res


def _limit_message(raw: str) -> str:
    reset = re.search(r"reset[s]? (?:at )?([^.\n|]+)", raw, re.I)
    tail = f" Sıfırlanma: {reset.group(1).strip()}." if reset else ""
    return ("Claude kullanım limiti doldu. İş duraklatıldı; limit sıfırlandığında 'Devam et' ile kaldığı yerden sürdürebilirsiniz."
            + tail)


def call(prompt: str, *, model: str, system: str, schema: dict | None = None, purpose: str = "",
         image_dir: Path | None = None, retries: int = 2) -> Any:
    """Run claude -p and return parsed JSON (structured output when a schema is given)."""
    timeout = int(db.get_settings().get("claude_timeout_sec") or 1200)
    attempt_prompt = prompt
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        started = time.time()
        try:
            res = _run_once(attempt_prompt, model=model, system=system, schema=schema, image_dir=image_dir,
                            timeout=timeout)
        except (ClaudeLimitError, ClaudeAuthError) as e:
            _log(model, purpose, started, False, e.message, None, len(attempt_prompt), e.detail)
            raise
        except QCError:
            raise
        except Exception as e:  # timeouts, transient CLI failures
            last_err = e
            _log(model, purpose, started, False, str(e)[:500], None, len(attempt_prompt), None)
            log.warning("claude çağrısı başarısız (%s/%s): %s", attempt + 1, retries + 1, e)
            time.sleep(3 * (attempt + 1))
            continue

        cost = res.get("total_cost_usd")
        if schema is None:
            text = res.get("result") or ""
            _log(model, purpose, started, True, None, cost, len(attempt_prompt), text)
            return text
        data = res.get("structured_output")
        raw = res.get("result") or ""
        try:
            if data is None:
                data = _extract_json(raw)
            _check_required(data, schema)
        except (ValueError, json.JSONDecodeError) as e:
            last_err = e
            _log(model, purpose, started, False, f"bozuk JSON: {e}", cost, len(attempt_prompt), raw)
            # ask for a corrected answer, keeping the original task
            attempt_prompt = (
                f"{prompt}\n\n---\nYour previous answer was not valid JSON for the required schema ({e}).\n"
                f"Previous answer:\n{raw[:4000]}\n\nReturn ONLY a corrected JSON object that matches the schema."
            )
            continue
        _log(model, purpose, started, True, None, cost, len(attempt_prompt), json.dumps(data, ensure_ascii=False))
        return data
    raise QCError("Claude analizi tamamlanamadı (birkaç denemeden sonra geçerli yanıt alınamadı).", str(last_err))


def status() -> dict:
    """CLI install + login check (no model call)."""
    out: dict[str, Any] = {"installed": False, "logged_in": False}
    try:
        exe = claude_exe()
    except QCError as e:
        out["error"] = e.message
        return out
    out["path"] = exe
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        v = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30, env=child_env(),
                           creationflags=flags)
        out["installed"] = v.returncode == 0
        out["version"] = v.stdout.strip()
        a = subprocess.run([exe, "auth", "status", "--json"], capture_output=True, text=True, timeout=30,
                           env=child_env(), creationflags=flags)
        info = json.loads(a.stdout or "{}")
        out["logged_in"] = bool(info.get("loggedIn"))
        out["auth_method"] = info.get("authMethod")
        out["subscription"] = info.get("subscriptionType")
        out["api_key_in_env"] = bool(os.environ.get("ANTHROPIC_API_KEY"))
    except Exception as e:
        out["error"] = str(e)
    return out
