#!/usr/bin/env python3
"""CLI client for Vidgist's local batch subtitle API."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

RUNTIME_FILE = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "VidgistSubtitleBridge" / "runtime.json"


def request(method: str, path: str, payload: dict | None = None) -> dict:
    if not RUNTIME_FILE.exists():
        raise RuntimeError("bridge is unavailable; load/reload Vidgist and run install_native_host.ps1 first")
    runtime = json.loads(RUNTIME_FILE.read_text(encoding="utf-8"))
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    call = Request("http://127.0.0.1:%s%s" % (runtime["port"], path), data=data, method=method,
                   headers={"Authorization": "Bearer " + runtime["token"], "Content-Type": "application/json"})
    try:
        with urlopen(call, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(exc.read().decode("utf-8", errors="replace")) from exc
    except URLError as exc:
        raise RuntimeError("bridge is unavailable; reload Vidgist") from exc


def save_markdown(job: dict, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for index, item in enumerate(job.get("items", []), 1):
        if item.get("status") != "ok" or not item.get("markdown"):
            continue
        title = "".join("_" if char in '\\\\/:*?\"<>|' else char for char in item["video"].get("title", "video")).strip(". ")[:100] or "video"
        (directory / ("%03d_%s.md" % (index, title))).write_text(item["markdown"], encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch-extract Bilibili and YouTube subtitles through Vidgist")
    sub = parser.add_subparsers(dest="command", required=True)
    extract = sub.add_parser("extract", help="submit one or more video URLs")
    extract.add_argument("videos", nargs="+", help="Bilibili or YouTube video URLs")
    extract.add_argument("--wait", action="store_true", help="wait for results")
    extract.add_argument("--timeout", type=int, default=1800)
    extract.add_argument("--output", type=Path, help="write successful transcripts as Markdown files here")
    status = sub.add_parser("status", help="read a submitted job")
    status.add_argument("job_id")
    args = parser.parse_args()
    try:
        if args.command == "status":
            print(json.dumps(request("GET", "/v1/jobs/" + args.job_id), ensure_ascii=False, indent=2))
            return 0
        job = request("POST", "/v1/jobs", {"videos": args.videos})
        if args.wait:
            deadline = time.monotonic() + args.timeout
            while job["status"] not in {"completed", "failed"}:
                if time.monotonic() >= deadline:
                    raise RuntimeError("timed out waiting for subtitle job")
                time.sleep(1)
                job = request("GET", "/v1/jobs/" + job["id"])
        if args.output and job["status"] == "completed":
            save_markdown(job, args.output)
        print(json.dumps(job, ensure_ascii=False, indent=2))
        return 0 if job["status"] != "failed" else 1
    except RuntimeError as exc:
        print("error: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
