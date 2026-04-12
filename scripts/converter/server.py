"""Office → PDF converter sidecar.

Exposes one endpoint:

    POST /convert   multipart/form-data, field "file"
        200 application/pdf        on success
        413 text/plain             file larger than MAX_SIZE_MB
        415 text/plain             unsupported format
        500 text/plain             LibreOffice error
        504 text/plain             LibreOffice exceeded TIMEOUT_SECONDS

Design notes:
  * One conversion at a time is fine for our scale. LibreOffice's
    headless mode spawns a new soffice subprocess per request; it is
    NOT thread-safe for concurrent conversions in the same profile,
    so we give each request its own --user-profile dir under /tmp.
  * We stream the request body to a tempfile (FastAPI's UploadFile
    spools to disk at 1MB by default) before invoking soffice so that
    LibreOffice sees a real path, not a pipe.
  * Output PDF is read into memory and returned in the response body.
    The converter does NOT persist converted files — caching is the
    caller's (backend's) responsibility.
  * tini (PID 1 in the container) reaps the soffice zombie when we
    SIGKILL on timeout. Without tini a killed soffice would linger
    and eventually exhaust pids.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse, Response

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s converter - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="NorthStar Office Converter", version="1.0.0")


# Aligned with spec FR-6 (120s) and FR-7 (100MB).
TIMEOUT_SECONDS = int(os.environ.get("CONVERTER_TIMEOUT_SECONDS", "120"))
MAX_SIZE_MB = int(os.environ.get("CONVERTER_MAX_SIZE_MB", "100"))
MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

# Allow-list of media types we know LibreOffice renders well. Anything
# outside this list is rejected at the converter layer too, as defense
# in depth on top of the backend's own 415 filter.
_SUPPORTED_MEDIA_TYPES = {
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    # LibreOffice also handles these, but the spec defers them:
    # "application/msword",
    # "application/vnd.ms-powerpoint",
    # "application/vnd.ms-excel",
}

# Extensions we can infer even when the client forgot the media_type
# header (e.g. a curl without -F "type=..."). Mirrors the allow-list.
_SUPPORTED_EXTS = {".pptx", ".docx", ".xlsx"}


def _is_supported(filename: str, content_type: str | None) -> bool:
    if content_type and content_type in _SUPPORTED_MEDIA_TYPES:
        return True
    ext = Path(filename).suffix.lower()
    return ext in _SUPPORTED_EXTS


@app.get("/health")
async def health() -> dict:
    # Cheap ping — does NOT spin up soffice. That would be >1s per
    # health check and make docker compose healthchecks flaky.
    return {"status": "ok"}


@app.post("/convert")
async def convert(file: UploadFile = File(...)) -> Response:
    started = time.monotonic()
    filename = file.filename or "unknown"

    if not _is_supported(filename, file.content_type):
        logger.warning(
            "rejected unsupported file name=%s content_type=%s",
            filename, file.content_type,
        )
        return PlainTextResponse(
            f"unsupported_format: {filename} ({file.content_type})",
            status_code=415,
        )

    # Materialize the upload to a tempfile. We enforce the size cap
    # while we drain so a malicious 1GB upload doesn't fill /tmp.
    # Per-request directory gives soffice an isolated user profile.
    workdir = Path(tempfile.mkdtemp(prefix="nsr_conv_"))
    try:
        src = workdir / Path(filename).name
        total = 0
        with src.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_SIZE_BYTES:
                    logger.warning(
                        "rejected oversized file name=%s bytes=%d limit=%d",
                        filename, total, MAX_SIZE_BYTES,
                    )
                    return PlainTextResponse(
                        f"file_too_large: {total} bytes > {MAX_SIZE_BYTES}",
                        status_code=413,
                    )
                out.write(chunk)

        # Run soffice. The --user-profile flag gives every request its
        # own profile dir, so concurrent conversions don't clobber each
        # other's registry. It also means we don't have to worry about
        # a hung soffice locking its profile and blocking future runs.
        profile_dir = workdir / "profile"
        out_dir = workdir / "out"
        out_dir.mkdir(exist_ok=True)

        cmd = [
            "soffice",
            "--headless",
            "--norestore",
            "--nologo",
            "--nofirststartwizard",
            f"-env:UserInstallation=file://{profile_dir}",
            "--convert-to", "pdf",
            "--outdir", str(out_dir),
            str(src),
        ]
        logger.info("starting conversion name=%s bytes=%d", filename, total)
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                proc.kill()
                # Reap the zombie so tini doesn't have to.
                try:
                    await proc.wait()
                except Exception:  # noqa: BLE001
                    pass
                elapsed = time.monotonic() - started
                logger.error(
                    "conversion timeout name=%s after=%.1fs limit=%ds",
                    filename, elapsed, TIMEOUT_SECONDS,
                )
                return PlainTextResponse(
                    f"timeout: soffice did not finish within {TIMEOUT_SECONDS}s",
                    status_code=504,
                )

            if proc.returncode != 0:
                logger.error(
                    "soffice failed rc=%d name=%s stderr=%s",
                    proc.returncode, filename,
                    (stderr or b"").decode("utf-8", errors="replace")[:500],
                )
                return PlainTextResponse(
                    f"conversion_failed: rc={proc.returncode}",
                    status_code=500,
                )
        except FileNotFoundError:
            logger.error("soffice binary not found — container misconfigured")
            return PlainTextResponse(
                "converter_misconfigured: soffice not on PATH",
                status_code=500,
            )

        # soffice names the output after the input stem, so we don't
        # have to guess the filename — just grab the only .pdf in the
        # out directory. That also survives unicode filename weirdness
        # where Python's Path("foo.pptx").with_suffix(".pdf") would
        # differ from what soffice actually wrote.
        pdfs = list(out_dir.glob("*.pdf"))
        if not pdfs:
            logger.error(
                "soffice finished but produced no pdf name=%s stderr=%s",
                filename,
                (stderr or b"").decode("utf-8", errors="replace")[:500],
            )
            return PlainTextResponse(
                "conversion_failed: no pdf produced",
                status_code=500,
            )
        pdf_path = pdfs[0]
        pdf_bytes = pdf_path.read_bytes()

        elapsed = time.monotonic() - started
        logger.info(
            "converted name=%s src_bytes=%d pdf_bytes=%d wall=%.1fs",
            filename, total, len(pdf_bytes), elapsed,
        )

        # Return as a bare binary response. PDF content is opaque; we
        # don't set Content-Disposition because the caller (backend)
        # will wrap with its own filename.
        return Response(content=pdf_bytes, media_type="application/pdf")

    finally:
        shutil.rmtree(workdir, ignore_errors=True)
