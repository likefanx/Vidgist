#!/usr/bin/env python3
"""Local HTTP bridge for Vidgist's Native Messaging connection.

The browser extension performs every signed-in request.  This process only
forwards URLs and transcript results, and binds to loopback with a fresh token.
"""
from __future__ import annotations

import json
import os
import secrets
import struct
import sys
import threading
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

RUNTIME_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "VidgistSubtitleBridge"
RUNTIME_FILE = RUNTIME_DIR / "runtime.json"
WRITE_LOCK = threading.Lock()
JOB_LOCK = threading.Lock()
JOBS: dict[str, dict] = {}
CHUNKS: dict[tuple[str, int], dict] = {}
TOKEN = secrets.token_urlsafe(32)
SERVER: ThreadingHTTPServer | None = None


def write_native_message(message: dict) -> bool:
    encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    try:
        with WRITE_LOCK:
            sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
            sys.stdout.buffer.write(encoded)
            sys.stdout.buffer.flush()
        return True
    except (BrokenPipeError, OSError):
        return False


def read_native_message() -> dict | None:
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return None
    size = struct.unpack("<I", header)[0]
    payload = sys.stdin.buffer.read(size)
    if len(payload) != size:
        return None
    return json.loads(payload.decode("utf-8"))


def valid_video_urls(values: object) -> list[str]:
    result, seen = [], set()
    for value in values if isinstance(values, list) else []:
        text = str(value).strip()
        parsed = urlparse(text)
        host = parsed.hostname.lower() if parsed.hostname else ""
        bilibili = host == "www.bilibili.com" and parsed.path.lower().startswith("/video/bv")
        youtube = host == "youtu.be" and len(parsed.path.strip("/")) >= 6
        if host in {"www.youtube.com", "youtube.com"}:
            youtube = (parsed.path == "/watch" and len(parse_qs(parsed.query).get("v", [""])[0]) >= 6) or (parsed.path.startswith("/shorts/") and len(parsed.path.split("/")) >= 3 and len(parsed.path.split("/")[2]) >= 6)
        valid = bilibili or youtube
        if valid and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def update_job(message: dict) -> None:
    job_id = message.get("jobId")
    if not isinstance(job_id, str):
        return
    with JOB_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        kind = message.get("type")
        if kind == "jobAccepted":
            job["status"] = "running"
            job["total"] = message.get("total", job["total"])
        elif kind == "jobProgress":
            job.update({key: message[key] for key in ("status", "current", "total", "url") if key in message})
        elif kind == "itemResult":
            job["items"].append(message.get("item", {}))
        elif kind == "itemChunk":
            key = (job_id, int(message.get("index", -1)))
            total = int(message.get("total", 0))
            if total <= 0 or key[1] < 0 or key[1] >= total:
                return
            bucket = CHUNKS.setdefault((job_id, total), {})
            bucket[key[1]] = message.get("data", "")
            if len(bucket) == total:
                try:
                    job["items"].append(json.loads("".join(bucket[index] for index in range(total))))
                finally:
                    CHUNKS.pop((job_id, total), None)
        elif kind == "jobResult":
            job["status"] = "completed" if message.get("success") else "failed"
            job["success"] = bool(message.get("success"))
            job["summary"] = message.get("summary", job.get("summary"))
            job["error"] = message.get("error")


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "VidgistSubtitleBridge/1.0"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def authorised(self) -> bool:
        return self.headers.get("Authorization", "") == "Bearer " + TOKEN

    def respond(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if not self.authorised():
            self.respond(HTTPStatus.UNAUTHORIZED, {"error": "invalid token"})
            return
        if self.path == "/v1/health":
            self.respond(HTTPStatus.OK, {"status": "ok"})
            return
        prefix = "/v1/jobs/"
        if not self.path.startswith(prefix):
            self.respond(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        with JOB_LOCK:
            job = JOBS.get(self.path[len(prefix):])
            result = dict(job) if job else None
        self.respond(HTTPStatus.OK if result else HTTPStatus.NOT_FOUND, result or {"error": "job not found"})

    def do_POST(self) -> None:
        if self.path != "/v1/jobs":
            self.respond(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if not self.authorised():
            self.respond(HTTPStatus.UNAUTHORIZED, {"error": "invalid token"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self.respond(HTTPStatus.BAD_REQUEST, {"error": "invalid JSON body"})
            return
        videos = valid_video_urls(payload.get("videos"))
        if not videos:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": "provide one or more Bilibili or YouTube video URLs"})
            return
        job_id = str(uuid.uuid4())
        job = {"id": job_id, "status": "queued", "videos": videos, "total": len(videos), "items": [], "summary": {"ok": 0, "error": 0}}
        with JOB_LOCK:
            JOBS[job_id] = job
        if not write_native_message({"type": "job", "jobId": job_id, "videos": videos}):
            job.update({"status": "failed", "error": "browser extension bridge is disconnected"})
            self.respond(HTTPStatus.SERVICE_UNAVAILABLE, job)
            return
        self.respond(HTTPStatus.ACCEPTED, job)


def write_runtime(port: int) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_FILE.write_text(json.dumps({"port": port, "token": TOKEN}, indent=2), encoding="utf-8")


def main() -> int:
    global SERVER
    SERVER = ThreadingHTTPServer(("127.0.0.1", 0), ApiHandler)
    write_runtime(SERVER.server_port)
    threading.Thread(target=SERVER.serve_forever, daemon=True).start()
    try:
        while (message := read_native_message()) is not None:
            update_job(message)
    finally:
        SERVER.shutdown()
        SERVER.server_close()
        RUNTIME_FILE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
