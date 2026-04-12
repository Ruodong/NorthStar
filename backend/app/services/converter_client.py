"""HTTP client for the northstar-converter sidecar.

The converter is an internal docker-network-only service that accepts
Office files (PPTX/DOCX/XLSX) via multipart POST and returns the PDF
bytes. This module hides the transport details from routers so the
preview endpoint stays a thin wrapper over file cache + convert call.

Spec references: office-preview FR-12 / FR-16 / NFR-2
"""
from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)


class ConverterError(Exception):
    """Raised when the converter sidecar fails to produce a PDF.

    The router maps this to HTTP 502 (converter_failed) or HTTP 504
    (converter_timeout), depending on `kind`. We intentionally do NOT
    use HTTPException here — keeping Exception types in the service
    layer makes the service unit-testable without a FastAPI context.
    """

    def __init__(self, kind: str, detail: str, status: int | None = None) -> None:
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail
        self.status = status


# FR-12: the backend URL is set by the CONVERTER_URL env var and points
# at the docker internal hostname. Defaults to the production value so
# local dev (docker compose up) doesn't need extra wiring. Tests that
# want to swap this can set the env var before importing the module or
# monkeypatch `CONVERTER_URL` directly.
CONVERTER_URL = os.environ.get("CONVERTER_URL", "http://converter:8080").rstrip("/")

# Backend-side timeout when calling the converter. The converter's own
# hard timeout is 120s (spec FR-6); we add a 5s margin to let soffice
# kill + cleanup + return the 504 body before our own read timeout
# trips. This matches NFR-2.
_HTTP_TIMEOUT = httpx.Timeout(connect=5.0, read=125.0, write=125.0, pool=5.0)


async def convert_to_pdf(
    source_bytes: bytes,
    filename: str,
    media_type: str,
) -> bytes:
    """Send `source_bytes` to the converter and return PDF bytes.

    Raises `ConverterError` on any failure. Caller is expected to wrap
    and return the appropriate HTTP status (502 / 504 / 415).

    We stream the upload as multipart with the correct field name the
    converter expects (`file`). httpx handles the multipart encoding
    so we don't have to manually build the boundary.
    """
    url = f"{CONVERTER_URL}/convert"
    files = {"file": (filename, source_bytes, media_type)}

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(url, files=files)
    except httpx.ConnectError as exc:
        logger.error("converter unreachable url=%s: %s", url, exc)
        raise ConverterError(
            kind="converter_unreachable",
            detail=f"cannot connect to {url}",
        ) from exc
    except httpx.ReadTimeout as exc:
        logger.error("converter timed out url=%s: %s", url, exc)
        raise ConverterError(
            kind="converter_timeout",
            detail=f"converter did not respond within {_HTTP_TIMEOUT.read}s",
            status=504,
        ) from exc
    except httpx.HTTPError as exc:
        logger.error("converter http error url=%s: %s", url, exc)
        raise ConverterError(
            kind="converter_failed",
            detail=str(exc),
        ) from exc

    if resp.status_code == 200:
        # Defensive sanity check — a genuine PDF always starts with %PDF-.
        # If the converter returned 200 but with text, that's a protocol
        # bug we want to fail loudly on, not a silent corrupt cache.
        body = resp.content
        if not body.startswith(b"%PDF-"):
            logger.error(
                "converter returned 200 but body is not a PDF: first_bytes=%r",
                body[:20],
            )
            raise ConverterError(
                kind="converter_failed",
                detail="non-PDF response body",
            )
        return body

    # Non-200: read the error text for the router to propagate.
    err_detail = (resp.text or "").strip()[:500]
    if resp.status_code == 504:
        raise ConverterError(kind="converter_timeout", detail=err_detail, status=504)
    if resp.status_code == 413:
        raise ConverterError(kind="file_too_large", detail=err_detail, status=413)
    if resp.status_code == 415:
        raise ConverterError(kind="unsupported_format", detail=err_detail, status=415)
    raise ConverterError(
        kind="converter_failed",
        detail=f"HTTP {resp.status_code}: {err_detail}",
    )
