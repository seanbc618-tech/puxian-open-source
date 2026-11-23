#!/usr/bin/env python3
"""Same-origin geom OMR API (and optional static preview).

Uses copisteria Detector (28m) + geom_from_dets. Does not load the evidence
model, Transcoda, or rokot. In production (GEOM_PRODUCTION=1) this process
is API-only, binds 127.0.0.1, does not keep uploads, and applies simple
concurrency / rate limits.
"""
from __future__ import annotations

import email
import email.policy
import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import threading
import time
import traceback
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DEFAULT_STATIC = Path(os.environ.get("GEOM_STATIC") or (ROOT.parent / "dist-static"))
HANDLER_ROOT = DEFAULT_STATIC
def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


PRODUCTION = _flag("GEOM_PRODUCTION", False)
API_ONLY = _flag("GEOM_API_ONLY", PRODUCTION)
KEEP_LAST_JOB = _flag("GEOM_KEEP_LAST_JOB", not PRODUCTION)
HOST = os.environ.get("GEOM_HOST", "127.0.0.1")
PORT = int(os.environ.get("GEOM_PORT", "18096" if PRODUCTION else "18095"))
MAX_UPLOAD = int(os.environ.get("GEOM_MAX_UPLOAD", str(20 * 1024 * 1024)))
MAX_CONCURRENT = int(os.environ.get("GEOM_MAX_CONCURRENT", "1" if PRODUCTION else "2"))
RATE_MAX = int(os.environ.get("GEOM_RATE_MAX", "6" if PRODUCTION else "30"))
RATE_WINDOW = float(os.environ.get("GEOM_RATE_WINDOW", "600" if PRODUCTION else "60"))
LOG_DIR = Path(os.environ.get("GEOM_LOG_DIR") or (ROOT.parent / "logs"))
LAST_UPLOAD_MAX = int(os.environ.get("GEOM_LAST_UPLOAD_MAX", str(8 * 1024 * 1024)))
GEOM_BANNER = os.environ.get(
    "GEOM_BANNER",
    "几何识谱（检测 + 谱线重建）。识别会有错，请对照原图校对后再写入主谱。",
)
VENDOR = Path(os.environ.get("GEOM_VENDOR") or (ROOT.parent / "vendor"))
COPISTERIA_ROOT = Path(os.environ.get("COPISTERIA_ROOT") or (VENDOR / "copisteria"))
GEOM_SCRIPT_DIR = Path(os.environ.get("GEOM_SCRIPT_DIR") or (VENDOR if (VENDOR / "geom_from_dets.py").exists() else ROOT))

# Make copisteria and geom_from_dets importable without a 1.9G Linux venv.
src = COPISTERIA_ROOT / "src"
if src.is_dir() and str(src) not in sys.path:
    sys.path.insert(0, str(src))
if str(GEOM_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(GEOM_SCRIPT_DIR))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_lock = threading.Lock()
_state = {
    "ready": False,
    "loading": False,
    "error": None,
    "device": None,
    "job": None,  # {id, stage, started, elapsed, error}
}
_detector = None
_inflight = 0
_recent: list[tuple[float, str]] = []
_job_sema = threading.BoundedSemaphore(max(1, MAX_CONCURRENT))


def _now() -> float:
    return time.time()


def _client_key(handler) -> str:
    forwarded = (handler.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    addr = getattr(handler, "client_address", None)
    return addr[0] if addr else "unknown"


def _rate_limited(key: str) -> bool:
    """True if this client has exceeded RATE_MAX requests in RATE_WINDOW seconds."""
    now = _now()
    with _lock:
        cutoff = now - RATE_WINDOW
        _recent[:] = [(when, who) for when, who in _recent if when >= cutoff]
        used = sum(1 for when, who in _recent if who == key)
        if used >= RATE_MAX:
            return True
        _recent.append((now, key))
        return False


def _set_job(**kwargs):
    with _lock:
        job = _state.get("job") or {}
        job.update(kwargs)
        job["elapsed"] = _now() - job.get("started", _now())
        _state["job"] = job


_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def _clip_token(value: str | None) -> str | None:
    if not value:
        return None
    token = value.strip()
    if not _TOKEN_RE.fullmatch(token):
        return None
    return token


def _presented_token(handler) -> str | None:
    header = _clip_token(handler.headers.get("X-Geom-Job"))
    if header:
        return header
    query = parse_qs(urlsplit(handler.path).query)
    return _clip_token((query.get("job") or [""])[0])


def _tokens_match(stored: str | None, presented: str | None) -> bool:
    if not stored or not presented or len(stored) != len(presented):
        return False
    return secrets.compare_digest(stored, presented)


def _public_job(job: dict | None, token: str | None) -> dict | None:
    """Job progress for the caller who presented this job's token. Others see nothing."""
    if not job or not _tokens_match(str(job.get("token") or ""), token):
        return None
    out = {}
    for key in ("id", "stage", "started", "elapsed", "error"):
        if key in job:
            out[key] = job[key]
    return out


def _user_facing(exc: BaseException) -> tuple[int, str] | None:
    if exc.__class__.__name__ != "GeomUserError":
        return None
    status = int(getattr(exc, "status", 422) or 422)
    if status < 400 or status > 499:
        status = 422
    return status, str(exc)


def _pick_device() -> str:
    forced = os.environ.get("GEOM_DEVICE")
    if forced:
        return forced
    try:
        import torch
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def load_detector():
    global _detector
    with _lock:
        if _detector is not None:
            return _detector
        if _state["loading"]:
            return None
        _state["loading"] = True
        _state["error"] = None
    device = _pick_device()
    try:
        from copisteria.detect import Detector
        from copisteria.paths import DETECTOR
        weights = Path(os.environ.get("GEOM_WEIGHTS") or DETECTOR)
        if not weights.is_file():
            raise FileNotFoundError(f"detector weights missing: {weights}")
        try:
            det = Detector(weights, device=device)
        except Exception:
            if device != "cpu":
                device = "cpu"
                det = Detector(weights, device=device)
            else:
                raise
        with _lock:
            _detector = det
            _state["ready"] = True
            _state["loading"] = False
            _state["device"] = device
            _state["error"] = None
        return det
    except Exception as exc:
        with _lock:
            _state["ready"] = False
            _state["loading"] = False
            _state["error"] = f"{type(exc).__name__}: {exc}"
        raise


def _preload():
    try:
        load_detector()
    except Exception:
        traceback.print_exc()


def detect_png(png: Path) -> list[dict]:
    """Same sizing path as copisteria.pipeline.detections, reused Detector."""
    from PIL import Image
    from copisteria.detect import imgsz_for, measure_space, staff_space
    from copisteria.paths import detector as detector_spec
    from copisteria.vision.page.scan import from_png
    from copisteria.vision.page.staves import find_staves

    det = load_detector()
    if det is None:
        # Another thread is loading; wait.
        for _ in range(600):
            time.sleep(0.1)
            det = load_detector()
            if det is not None:
                break
        if det is None:
            raise RuntimeError("detector failed to load")
    _set_job(stage="正在定位谱表并准备检测…")
    page = from_png(png)
    ink = find_staves(page.image()).spacing
    im = Image.open(png)
    try:
        from geom_from_dets import page_uses_engraved_line_reads
        if page_uses_engraved_line_reads(im):
            # Per-line detection with an expanded curve view happens in
            # events_for_page(live_detect=True). Skip a full-page YOLO pass.
            _set_job(stage="正在按行裁切并扩边检测连音…")
            from copisteria.paths import detector as detector_spec
            tag = detector_spec()[1]
            png.with_name(f"{png.stem}.dets_{tag}_engraved.json").write_text("[]", encoding="utf-8")
            return []
    except Exception:
        pass
    _set_job(stage="正在运行符号检测（可能需要一两分钟）…")
    arr, s = det.prepare(im, 2048)
    first = det.run_array(arr, s)
    imgsz = imgsz_for(staff_space(ink, measure_space(first)), max(im.width, im.height))
    if imgsz == 2048:
        dets = first
    else:
        _set_job(stage=f"正在以 {imgsz} 像素重跑检测…")
        arr, s = det.prepare(im, imgsz)
        dets = det.run_array(arr, s)
    tag = detector_spec()[1]
    png.with_name(f"{png.stem}.dets_{tag}_{imgsz}.json").write_text(json.dumps(dets), encoding="utf-8")
    return dets


def run_geom(image_path: Path, dets_path: Path, title: str | None = None) -> tuple[list[dict], dict, str]:
    from events_to_score import events_to_musicxml, events_to_score
    from geom_from_dets import events_for_page, infer_key, load_dets
    from tempo_from_dets import infer_tempo

    _set_job(stage="正在按谱线重建音高和时值…")
    dets = load_dets(dets_path)
    key = infer_key(dets)
    # A printed ♩= is kept only when the detector states the number. Otherwise
    # the draft stays unmarked instead of substituting 96.
    bpm = infer_tempo(dets)
    events = events_for_page(image_path, dets_path, key=None, live_detect=True)
    shown = title or (image_path.stem + " · 几何识谱草稿")
    score = events_to_score(events, title=shown, key=key or "C", bpm=bpm)
    musicxml = events_to_musicxml(events, score)
    return events, score, musicxml


def parse_multipart(handler) -> tuple[bytes, str, str | None]:
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0 or length > MAX_UPLOAD:
        raise ValueError(f"upload must be between 1 byte and {MAX_UPLOAD} bytes")
    body = handler.rfile.read(length)
    header_token = _presented_token(handler)
    ctype = handler.headers.get("Content-Type", "")
    if "multipart/form-data" not in ctype:
        # raw image body
        return body, "upload.png", header_token
    msg = email.message_from_bytes(
        b"Content-Type: " + ctype.encode("utf-8") + b"\r\n\r\n" + body,
        policy=email.policy.default,
    )
    image: bytes | None = None
    filename = "upload.png"
    form_token: str | None = None
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name == "job":
            raw = part.get_payload(decode=True) or b""
            form_token = _clip_token(raw.decode("utf-8", "replace"))
            continue
        if name in ("image", "file", "page", None) or (name or "").startswith("image"):
            payload = part.get_payload(decode=True) or b""
            if payload and image is None:
                image = payload
                filename = part.get_filename() or "upload.png"
    if not image:
        raise ValueError("multipart body had no image field")
    return image, filename, header_token or form_token



def write_last_job(
    *,
    filename: str,
    image_path: Path,
    score: dict,
    events: list[dict],
    job: dict | None,
) -> None:
    """Preview-only: overwrite a tiny last-job record. Disabled in production."""
    if not KEEP_LAST_JOB:
        return
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        width = height = None
        try:
            from PIL import Image
            with Image.open(image_path) as im:
                width, height = im.size
        except Exception:
            pass
        record = {
            "timestamp": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(),
            "filename": filename,
            "title": score.get("title"),
            "nEvents": len(events),
            "width": width,
            "height": height,
            "firstPitches": [int(e["pitch"]) for e in events[:12]],
            "elapsed": (job or {}).get("elapsed"),
            "device": _state.get("device"),
            "key": score.get("key"),
            "beats": score.get("beats"),
            "beatUnit": score.get("beatUnit"),
        }
        saved = None
        if image_path.is_file() and image_path.stat().st_size <= LAST_UPLOAD_MAX:
            suffix = image_path.suffix.lower() or ".png"
            dest = LOG_DIR / f"last-geom-upload{suffix}"
            for old in LOG_DIR.glob("last-geom-upload.*"):
                if old != dest:
                    try:
                        old.unlink()
                    except OSError:
                        pass
            shutil.copy2(image_path, dest)
            saved = dest.name
        record["lastUpload"] = saved
        (LOG_DIR / "last-geom-job.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception:
        traceback.print_exc()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HANDLER_ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, code: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _status_payload(self, token: str | None = None) -> dict:
        with _lock:
            job = dict(_state["job"]) if _state["job"] else None
            if job and job.get("started"):
                job["elapsed"] = _now() - job["started"]
            visible = _public_job(job, token)
            payload = {
                "ok": True,
                "engine": "copisteria-geom",
                "banner": GEOM_BANNER,
                "ready": bool(_state["ready"]),
                "loading": bool(_state["loading"]),
                "device": _state.get("device"),
                "error": _state.get("error"),
            }
            # Omit job entirely unless this request holds the uploader's token.
            if visible is not None:
                payload["job"] = visible
            return payload

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/api/geom-omr/status", "/api/geom-omr"):
            # Kick a load if needed, but do not block the status probe.
            if not _state["ready"] and not _state["loading"] and _state["error"] is None:
                threading.Thread(target=_preload, name="geom-preload", daemon=True).start()
            return self._json(200, self._status_payload(_presented_token(self)))
        if API_ONLY:
            self.send_error(404, "not found")
            return
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/geom-omr":
            self.send_error(404, "not found")
            return
        if _rate_limited(_client_key(self)):
            return self._json(429, {"ok": False, "error": "识别请求过于频繁，请稍后再试。"})
        job_id = f"job-{int(_now() * 1000)}"
        try:
            payload, filename, job_token = parse_multipart(self)
        except Exception as exc:
            return self._json(400, {"ok": False, "error": str(exc)})
        job_token = job_token or secrets.token_urlsafe(24)
        if len(payload) > MAX_UPLOAD:
            return self._json(400, {"ok": False, "error": f"upload must be between 1 byte and {MAX_UPLOAD} bytes"})
        suffix = Path(filename).suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}:
            suffix = ".png"
        if not _job_sema.acquire(blocking=False):
            return self._json(429, {"ok": False, "error": "识别服务正忙，请稍后再试。"})
        tmpdir = tempfile.TemporaryDirectory(prefix="puxian-geom-")
        try:
            with _lock:
                _state["job"] = {
                    "id": job_id,
                    "token": job_token,
                    "stage": "已收到图片，正在写入临时文件…",
                    "started": _now(),
                    "elapsed": 0,
                    "error": None,
                }
            image_path = Path(tmpdir.name) / f"upload{suffix}"
            image_path.write_bytes(payload)
            dets = detect_png(image_path)
            # detections writes cache next to the temp png; events_for_page needs the path
            dets_path = next(Path(tmpdir.name).glob("upload.dets_*.json"), None)
            if dets_path is None:
                dets_path = Path(tmpdir.name) / "upload.dets_v7_manual.json"
                dets_path.write_text(json.dumps(dets), encoding="utf-8")
            stem = Path(filename).stem.strip() or "识谱"
            events, score, musicxml = run_geom(image_path, dets_path, f"{stem} · 几何识谱草稿")
            slim_events = [
                {"pitch": int(e["pitch"]), "start": float(e["start"]), "dur": float(e["dur"])}
                | ({"clef": e["clef"]} if e.get("clef") else {})
                for e in events
            ]
            _set_job(stage="完成", error=None)
            caller_job = self._status_payload(job_token).get("job")
            write_last_job(
                filename=filename,
                image_path=image_path,
                score=score,
                events=slim_events,
                job=caller_job,
            )
            return self._json(
                200,
                {
                    "ok": True,
                    "engine": "copisteria-geom",
                    "banner": GEOM_BANNER,
                    "device": _state.get("device"),
                    "nEvents": len(slim_events),
                    "events": slim_events,
                    "score": score,
                    "musicxml": musicxml,
                    "job": caller_job,
                },
            )
        except Exception as exc:
            user = _user_facing(exc)
            if user:
                code, message = user
                sys.stderr.write("geom refused: %s\n" % message)
                _set_job(stage="失败", error=message)
                return self._json(
                    code,
                    {"ok": False, "engine": "copisteria-geom", "error": message},
                )
            traceback.print_exc()
            _set_job(stage="失败", error=None)
            return self._json(
                500,
                {"ok": False, "engine": "copisteria-geom", "error": "识别没有完成，请稍后再试。"},
            )
        finally:
            tmpdir.cleanup()
            _job_sema.release()


def main():
    static = DEFAULT_STATIC
    if PRODUCTION and HOST not in {"127.0.0.1", "::1"}:
        raise SystemExit("GEOM_PRODUCTION=1 requires GEOM_HOST=127.0.0.1")
    global HANDLER_ROOT
    if API_ONLY:
        if not static.is_dir():
            static = Path(tempfile.mkdtemp(prefix="puxian-geom-empty-"))
    elif not static.is_dir():
        raise SystemExit(f"GEOM_STATIC not found: {static} (build:static first)")
    HANDLER_ROOT = static
    threading.Thread(target=_preload, name="geom-preload", daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    # SO_REUSEADDR is already default-ish; keep bind address explicit.
    print(
        json.dumps(
            {
                "ok": True,
                "url": f"http://{HOST}:{PORT}/",
                "api": f"http://{HOST}:{PORT}/api/geom-omr/status",
                "static": str(static),
                "pid": os.getpid(),
                "bind": HOST,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
