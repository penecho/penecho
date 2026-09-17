#!/usr/bin/env python3
"""Run explicit architecture-prompt experiments; keep credentials in memory only.

Start interactively, enter the API key at the non-echoing prompt, then submit
one JSON line per job: {"job": "path/to/job.json"}. Send {"quit": true} to exit.
Jobs contain endpoint, model, system, prompt, outputDir and optional parameters.
Only final text and usage are persisted; reasoning content is discarded.
"""

import getpass
import base64
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import sys
import time
from threading import Lock
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("API redirect refused; verify the explicit endpoint")


OUTPUT_LOCK = Lock()


def emit(value):
    with OUTPUT_LOCK:
        print(json.dumps(value, ensure_ascii=False), flush=True)


def run_job(job_path, api_key):
    job = json.loads(Path(job_path).read_text())
    endpoint = job["endpoint"]
    if not endpoint.startswith("https://"):
        raise ValueError("HTTPS endpoint required")
    output = Path(job["outputDir"])
    output.mkdir(parents=True, exist_ok=False)
    # Optional rendered evidence for Flash's review/repair step. Keep the exact
    # image bytes and hashes reproducible; never add unrelated screenshots.
    images = job.get("images", [])
    if not isinstance(images, list) or len(images) > 5:
        raise ValueError("Expected at most five explicitly selected review images")
    content = [{"type": "text", "text": job["prompt"]}]
    image_metadata = []
    for image_path in images:
        image_path = Path(image_path)
        mime = {".png":"image/png", ".jpg":"image/jpeg",
                ".jpeg":"image/jpeg", ".webp":"image/webp"}.get(image_path.suffix.lower())
        data = image_path.read_bytes()
        if not mime or not 0 < len(data) <= 10_000_000:
            raise ValueError("Review image must be PNG/JPEG/WebP and at most 10 MB")
        content.append({"type":"image", "source":{"type":"base64", "media_type":mime,
                        "data":base64.b64encode(data).decode("ascii")}})
        image_metadata.append({"path":str(image_path), "mime":mime, "bytes":len(data),
                               "sha256":hashlib.sha256(data).hexdigest()})
    payload = {
        "model": job["model"], "max_tokens": 24000, "stream": True,
        "system": job["system"],
        "messages": [{"role": "user", "content": content if images else job["prompt"]}],
        **job.get("parameters", {}),
    }
    wire = json.dumps(payload, ensure_ascii=False).encode()
    (output / "request.json").write_bytes(wire)
    request = urllib.request.Request(endpoint, data=wire, headers={
        "Content-Type": "application/json", "x-api-key": api_key,
        "anthropic-version": "2023-06-01", "Accept": "text/event-stream",
    })
    started = time.monotonic()
    metadata = {"endpoint": endpoint, "requestedModel": job["model"],
                "outputFormat": job.get("outputFormat", "html"),
                "requestSha256": hashlib.sha256(wire).hexdigest(),
                "systemSha256": hashlib.sha256(job["system"].encode()).hexdigest(),
                "parameters": {k: v for k, v in payload.items()
                               if k not in ("messages", "system")},
                "usage": {}, "eventTypes": {}, "deltaTypes": {}, "completed": False}
    if images:
        metadata["reviewImages"] = image_metadata
    chunks = []
    last_progress = started
    try:
        opener = urllib.request.build_opener(NoRedirect)
        with opener.open(request, timeout=180) as response:
            metadata["httpStatus"] = response.status
            emit({"state": "streaming", "job": str(job_path)})
            if "event-stream" not in response.headers.get("Content-Type", ""):
                body = json.load(response)
                for block in body.get("content", []):
                    if block.get("type") == "text":
                        chunks.append(block.get("text", ""))
                metadata.update({"returnedModel": body.get("model"),
                                 "usage": body.get("usage", {}),
                                 "stopReason": body.get("stop_reason"),
                                 "completed": body.get("stop_reason") == "end_turn"})
            else:
                for line in response:
                    if not line.startswith(b"data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == b"[DONE]":
                        continue
                    event = json.loads(data)
                    kind = event.get("type")
                    metadata["eventTypes"][str(kind)] = metadata["eventTypes"].get(str(kind), 0) + 1
                    if kind == "message_start":
                        message = event.get("message", {})
                        metadata["returnedModel"] = message.get("model")
                        metadata["usage"].update(message.get("usage", {}))
                        emit({"state": "model", "job": str(job_path), "returnedModel": message.get("model")})
                    elif kind == "content_block_start":
                        block = event.get("content_block", {})
                        if block.get("type") == "text":
                            chunks.append(block.get("text", ""))
                    elif kind == "content_block_delta":
                        delta = event.get("delta", {})
                        delta_kind = str(delta.get("type"))
                        metadata["deltaTypes"][delta_kind] = metadata["deltaTypes"].get(delta_kind, 0) + 1
                        if delta.get("type") == "text_delta":
                            chunks.append(delta.get("text", ""))
                        # Never persist or expose thinking deltas.
                    elif kind == "message_delta":
                        metadata["usage"].update(event.get("usage", {}))
                        reason = event.get("delta", {}).get("stop_reason")
                        if reason:
                            metadata["stopReason"] = reason
                    elif kind == "message_stop":
                        metadata["completed"] = metadata.get("stopReason") == "end_turn"
                    elif kind == "error":
                        raise RuntimeError(json.dumps(event.get("error", {})))
                    now = time.monotonic()
                    if now - last_progress >= 15:
                        emit({"state": "progress", "job": str(job_path), "elapsedSeconds": round(now-started),
                              "visibleCharacters": sum(map(len, chunks)),
                              "eventTypes": metadata["eventTypes"], "deltaTypes": metadata["deltaTypes"]})
                        last_progress = now
        text = "".join(chunks)
        (output / "response.txt").write_text(text)
        # Remove only a transport fence. Repairs apply exact model-authored
        # replacements to a separately retained original; no fuzzy/manual edits.
        html = text.strip()
        if job.get("outputFormat") == "replace-patches":
            patch_text = html
            fenced_patch = re.fullmatch(r"```(?:json)?\s*\n([\s\S]*?)\n```", patch_text)
            if fenced_patch:
                patch_text = fenced_patch.group(1)
            patch = json.loads(patch_text)
            if not isinstance(patch, dict) or set(patch) != {"replacements"}:
                raise ValueError("Expected a replacements object")
            replacements = patch["replacements"]
            if not isinstance(replacements, list) or not 1 <= len(replacements) <= 32:
                raise ValueError("Expected 1–32 exact replacements")
            original = Path(job["sourceHtml"]).read_text()
            metadata["baseHtmlSha256"] = hashlib.sha256(original.encode()).hexdigest()
            html = original
            for replacement in replacements:
                if not isinstance(replacement, dict) or set(replacement) != {"old", "new"}:
                    raise ValueError("Replacement requires only old/new")
                old, new = replacement["old"], replacement["new"]
                if not isinstance(old, str) or not old or not isinstance(new, str):
                    raise ValueError("Replacement text is invalid")
                if html.count(old) != 1:
                    raise ValueError("Replacement must match exactly once")
                html = html.replace(old, new, 1)
            metadata["replacementsApplied"] = len(replacements)
            (output / "model-patches.json").write_text(json.dumps(patch, ensure_ascii=False, indent=2))
        fenced = re.fullmatch(r"```(?:html)?\s*\n([\s\S]*?)\n```", html)
        if fenced:
            html = fenced.group(1)
        if not re.search(r"<(?:!doctype\s+html|html)\b", html, re.I):
            raise ValueError("Response is not a complete HTML document")
        if not metadata["completed"]:
            raise ValueError("Model did not finish normally; partial output is not accepted")
        (output / "response.html").write_text(html)
        metadata["htmlSha256"] = hashlib.sha256(html.encode()).hexdigest()
        metadata["htmlBytes"] = len(html.encode())
    except urllib.error.HTTPError as error:
        metadata["httpStatus"] = error.code
        metadata["error"] = error.read(4000).decode(errors="replace").replace(api_key, "[REDACTED]")
    except Exception as error:
        metadata["error"] = str(error).replace(api_key, "[REDACTED]")
    finally:
        metadata["elapsedSeconds"] = round(time.monotonic() - started, 2)
        (output / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    emit({"state": "finished", "outputDir": str(output), **metadata})


def main():
    if not sys.stdin.isatty():
        raise SystemExit("Use an interactive terminal so the API key is never echoed")
    api_key = getpass.getpass("API key (not echoed or saved): ")
    if not api_key:
        raise SystemExit("Missing API key")
    emit({"state": "ready"})
    for line in sys.stdin:
        try:
            command = json.loads(line)
            if command.get("quit"):
                break
            if "jobs" in command:
                jobs = command["jobs"]
                if not isinstance(jobs, list) or not 1 <= len(jobs) <= 2:
                    raise ValueError("A batch must contain one or two independent jobs")
                with ThreadPoolExecutor(max_workers=2) as pool:
                    for future in [pool.submit(run_job, job, api_key) for job in jobs]:
                        future.result()
            else:
                run_job(command["job"], api_key)
        except Exception as error:
            emit({"state": "error", "error": str(error).replace(api_key, "[REDACTED]")})
        emit({"state": "ready"})
    api_key = None


if __name__ == "__main__":
    main()
