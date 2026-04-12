"""Image → structured architecture JSON via multimodal LLM.

Phase 1 of image-vision-extract. Stateless service: preprocess an
image, call the Lenovo aiverse LLM (OpenAI-compatible chat-completions
endpoint) with a NorthStar-adapted architecture prompt, parse the
response, return structured JSON. No persistence.

Spec: .specify/features/image-vision-extract/spec.md  (FR-8..FR-19)

Deliberate design choices:

* Plain httpx, no langchain. EAM uses langchain because it orchestrates
  a multi-stage DAG; Phase 1 is a single call, so one httpx.AsyncClient
  matches the rest of backend/app/services/* and saves the ~50MB
  langchain/langgraph install.

* PIL for preprocessing (resize, format conversion, transparency
  compositing). Pillow is a new backend dep, ~5MB.

* Prompt lives in a sibling .md file so it's reviewable without a code
  change. Loaded once at module import.

* All errors raise a domain exception; the router maps to HTTP codes.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, UnidentifiedImageError

from app.config import settings

logger = logging.getLogger(__name__)


# Load the prompt once at import. If the file is missing we fail
# loudly at module import rather than at request time.
_PROMPT_PATH = Path(__file__).parent / "image_vision_prompt.md"
if not _PROMPT_PATH.exists():
    raise RuntimeError(
        f"image_vision_prompt.md not found at {_PROMPT_PATH} — "
        "this is required for the vision-extract endpoint"
    )
VISION_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")


# Limits. Upper bounds on per-request work, matching spec NFR-6.
MAX_RAW_BYTES = 10 * 1024 * 1024        # 10 MB raw image ceiling
MAX_DIMENSION = 2048                    # max width/height after resize
JPEG_QUALITY = 90                        # after PIL re-encode
LLM_TIMEOUT_SECONDS = 120.0             # per-request wall clock
LLM_MAX_RETRIES = 1                      # one retry on transient 5xx


class VisionExtractError(Exception):
    """Base error for the image-vision-extract service. Carries an
    `error_code` the router maps to an HTTP status + JSON body."""

    def __init__(self, error_code: str, detail: str = "", status: int = 500):
        super().__init__(f"{error_code}: {detail}")
        self.error_code = error_code
        self.detail = detail
        self.status = status


@dataclass
class VisionExtractResult:
    diagram_type: str = "unknown"
    applications: list[dict[str, Any]] = field(default_factory=list)
    interactions: list[dict[str, Any]] = field(default_factory=list)
    tech_components: list[dict[str, Any]] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "diagram_type": self.diagram_type,
            "applications": self.applications,
            "interactions": self.interactions,
            "tech_components": self.tech_components,
            "meta": self.meta,
        }


def _preprocess_image(raw: bytes, source_name: str = "<image>") -> bytes:
    """Decode, resize, composite onto white, re-encode as JPEG.

    Raises VisionExtractError with specific error codes the router
    can map to distinct HTTP statuses.
    """
    if len(raw) > MAX_RAW_BYTES:
        raise VisionExtractError(
            "file_too_large",
            f"{len(raw)} bytes > {MAX_RAW_BYTES}",
            status=413,
        )

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()  # force decode now so broken files fail here not later
    except UnidentifiedImageError as exc:
        raise VisionExtractError(
            "image_decode_failed",
            f"PIL cannot decode {source_name}: {exc}",
            status=500,
        ) from exc
    except OSError as exc:
        raise VisionExtractError(
            "image_decode_failed",
            f"truncated or corrupt image: {exc}",
            status=500,
        ) from exc

    # Composite transparency onto a white background so the vision
    # model sees a clean canvas. Lenovo PPT exports frequently have
    # transparent PNGs which confuse the LLM's color-status mapping.
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Resize so the longest edge is MAX_DIMENSION. thumbnail() keeps
    # aspect ratio and only shrinks; a small image stays small.
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue()


def _strip_code_fence(text: str) -> str:
    """LLMs occasionally wrap JSON in ```json ... ``` despite our
    strict-output instructions. Strip the fence defensively."""
    text = text.strip()
    if text.startswith("```"):
        # Drop the first line (```json or ```) and trailing ```
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_llm_json(raw: str) -> dict[str, Any]:
    """Parse the LLM response as a single JSON object. Tolerates
    stray whitespace and code fences, but NOT commentary."""
    text = _strip_code_fence(raw)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Last-resort: find the first {...} block
    m = _JSON_OBJECT_RE.search(text)
    if not m:
        raise VisionExtractError(
            "malformed_llm_output",
            f"no JSON object found in response: {raw[:500]!r}",
            status=502,
        )
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError as exc:
        raise VisionExtractError(
            "malformed_llm_output",
            f"response is not valid JSON: {exc}; raw={raw[:500]!r}",
            status=502,
        ) from exc


def _validate_and_normalize(parsed: dict[str, Any]) -> VisionExtractResult:
    """Coerce LLM-returned dict into our VisionExtractResult shape.

    We do NOT reject on missing fields — models occasionally drop
    one or two. Instead we default them and let the UI show the
    result. A completely malformed response (no applications key
    at all) still produces a result with empty arrays and a
    diagram_type of 'unknown'.
    """
    diagram_type = parsed.get("diagram_type") or "unknown"
    if diagram_type not in ("app_arch", "tech_arch", "unknown"):
        diagram_type = "unknown"

    # Applications: coerce each entry to the contract shape
    applications: list[dict[str, Any]] = []
    for entry in (parsed.get("applications") or []):
        if not isinstance(entry, dict):
            continue
        applications.append({
            "app_id": str(entry.get("app_id") or entry.get("id") or entry.get("name") or ""),
            "id_is_standard": bool(entry.get("id_is_standard", False)),
            "standard_id": str(entry.get("standard_id") or ""),
            "name": str(entry.get("name") or ""),
            "functions": [str(f) for f in (entry.get("functions") or []) if f],
            "application_status": str(entry.get("application_status") or ""),
            "source": "vision",
        })

    interactions: list[dict[str, Any]] = []
    for entry in (parsed.get("interactions") or []):
        if not isinstance(entry, dict):
            continue
        interactions.append({
            "source_app_id": str(entry.get("source_app_id") or ""),
            "target_app_id": str(entry.get("target_app_id") or ""),
            "interaction_type": str(entry.get("interaction_type") or ""),
            "direction": str(entry.get("direction") or ""),
            "business_object": str(entry.get("business_object") or ""),
            "interface_status": str(entry.get("interface_status") or ""),
            "status_inferred_from_endpoints": bool(
                entry.get("status_inferred_from_endpoints", False)
            ),
            "source": "vision",
        })

    tech_components: list[dict[str, Any]] = []
    for entry in (parsed.get("tech_components") or []):
        if not isinstance(entry, dict):
            continue
        tech_components.append({
            "name": str(entry.get("name") or ""),
            "component_type": str(entry.get("component_type") or ""),
            "layer": str(entry.get("layer") or ""),
            "deploy_mode": str(entry.get("deploy_mode") or ""),
            "runtime": str(entry.get("runtime") or ""),
            "source": "vision",
        })

    return VisionExtractResult(
        diagram_type=diagram_type,
        applications=applications,
        interactions=interactions,
        tech_components=tech_components,
    )


async def extract_image(image_bytes: bytes, source_name: str = "<image>") -> VisionExtractResult:
    """End-to-end: preprocess → LLM → parse → normalize.

    Raises VisionExtractError with a specific error_code on any
    failure. Caller (router) maps these to HTTP.
    """
    if not (settings.llm_enabled and settings.llm_base_url and settings.llm_api_key):
        raise VisionExtractError(
            "llm_disabled",
            "LLM_ENABLED=false or LLM_BASE_URL / LLM_API_KEY missing in backend env",
            status=503,
        )

    started = time.monotonic()

    jpeg_bytes = _preprocess_image(image_bytes, source_name=source_name)
    b64 = base64.b64encode(jpeg_bytes).decode("ascii")

    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": VISION_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Extract the architecture from this diagram. Return the JSON object as specified.",
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{b64}",
                        },
                    },
                ],
            },
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }

    last_exc: Exception | None = None
    response_json: dict[str, Any] | None = None
    for attempt in range(LLM_MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=10.0, read=LLM_TIMEOUT_SECONDS, write=30.0, pool=5.0),
            ) as client:
                resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                response_json = resp.json()
                break
            if 500 <= resp.status_code < 600 and attempt < LLM_MAX_RETRIES:
                logger.warning(
                    "llm upstream 5xx attempt=%d status=%d; retrying",
                    attempt + 1, resp.status_code,
                )
                time.sleep(2)
                continue
            # Non-retryable failure — map to upstream error
            raise VisionExtractError(
                "llm_upstream_error",
                f"HTTP {resp.status_code}: {(resp.text or '')[:400]}",
                status=502,
            )
        except httpx.TimeoutException as exc:
            last_exc = exc
            elapsed = time.monotonic() - started
            raise VisionExtractError(
                "llm_timeout",
                f"LLM did not respond within {LLM_TIMEOUT_SECONDS}s (elapsed {elapsed:.1f}s)",
                status=504,
            ) from exc
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt < LLM_MAX_RETRIES:
                logger.warning(
                    "llm http error attempt=%d: %s; retrying",
                    attempt + 1, exc,
                )
                time.sleep(2)
                continue
            raise VisionExtractError(
                "llm_upstream_error",
                f"httpx error: {exc}",
                status=502,
            ) from exc

    if response_json is None:
        raise VisionExtractError(
            "llm_upstream_error",
            f"no successful response after retries; last_exc={last_exc}",
            status=502,
        )

    # OpenAI-compatible chat-completion response shape
    try:
        choice = response_json["choices"][0]
        content = choice["message"]["content"]
        usage = response_json.get("usage") or {}
    except (KeyError, IndexError, TypeError) as exc:
        raise VisionExtractError(
            "malformed_llm_output",
            f"unexpected response envelope: {exc}; body={str(response_json)[:400]!r}",
            status=502,
        ) from exc

    parsed = _parse_llm_json(content if isinstance(content, str) else str(content))
    result = _validate_and_normalize(parsed)

    wall_ms = int((time.monotonic() - started) * 1000)
    result.meta = {
        "model": settings.llm_model,
        "prompt_tokens": int(usage.get("prompt_tokens") or 0),
        "completion_tokens": int(usage.get("completion_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
        "wall_ms": wall_ms,
    }

    logger.info(
        "vision extract ok source=%s diagram_type=%s apps=%d inters=%d tokens=%d wall=%dms",
        source_name,
        result.diagram_type,
        len(result.applications),
        len(result.interactions),
        result.meta["total_tokens"],
        wall_ms,
    )
    return result
