"""S3-compatible object storage for NorthStar attachments.

Thin wrapper around boto3 matching the config that works with Lenovo OSS2
(`oss2.xcloud.lenovo.com`). The gateway rejects `Transfer-Encoding: chunked`,
so every PUT carries explicit `ContentLength`.

All errors are caught + logged; callers see `None` / exception and are
expected to fall back to filesystem. The backend never crashes a request
because S3 is unavailable.

See `.specify/features/s3-attachments/spec.md` §FR-3..FR-5 for contract.
"""
from __future__ import annotations

import logging
from io import BytesIO
from typing import Iterable, Iterator, Optional

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy singleton client
# ---------------------------------------------------------------------------

_client = None
_client_init_failed = False


def _get_client():
    """Lazily build the boto3 S3 client. Caches on success, remembers failure
    so we don't retry boto3 import / connect on every request.

    Returns None if S3 is disabled or the client cannot be built.
    """
    global _client, _client_init_failed
    if not settings.s3_enabled:
        return None
    if _client is not None:
        return _client
    if _client_init_failed:
        return None
    try:
        import boto3  # local import — zero cost when s3_enabled=False
        from botocore.config import Config as BotoConfig

        _client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=BotoConfig(
                s3={"addressing_style": "path"},
                signature_version="s3",
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
                connect_timeout=10,
                read_timeout=60,
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
        logger.info(
            "S3 client initialized: endpoint=%s bucket=%s prefix=%s",
            settings.s3_endpoint, settings.s3_bucket, settings.s3_prefix,
        )
        return _client
    except Exception as e:  # noqa: BLE001 — we want to log anything from boto
        logger.error("S3 client init failed: %s", e)
        _client_init_failed = True
        return None


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def make_key(filename: str) -> str:
    """Build the full S3 object key for a given attachment filename.

    >>> make_key("106273020.jpg")
    'pm/northstar/attachments/106273020.jpg'
    """
    prefix = settings.s3_prefix.rstrip("/")
    return f"{prefix}/{filename}"


def head(key: str) -> Optional[dict]:
    """Return HeadObject metadata, or None if missing / unreachable.

    Callers use the ContentLength field to decide whether a re-upload is needed.
    """
    client = _get_client()
    if client is None:
        return None
    try:
        return client.head_object(Bucket=settings.s3_bucket, Key=key)
    except Exception as e:  # noqa: BLE001
        # Expected on 404s; also covers network errors
        logger.debug("S3 head_object miss for %s: %s", key, e)
        return None


def upload_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> bool:
    """Upload *data* to *key*. Returns True on success, False on any failure.

    Uses explicit ContentLength (avoids Transfer-Encoding: chunked, which
    the Lenovo OSS2 gateway rejects with NotImplemented).
    """
    client = _get_client()
    if client is None:
        return False
    try:
        client.put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=data,
            ContentLength=len(data),
            ContentType=content_type,
        )
        return True
    except Exception as e:  # noqa: BLE001
        logger.error("S3 upload failed for %s: %s", key, e)
        return False


def download_stream(key: str, chunk_size: int = 1024 * 1024) -> Optional[Iterator[bytes]]:
    """Return a generator that yields chunks of the S3 object, or None on failure.

    The generator closes the underlying response body when exhausted or GC'd.
    Intended to be fed into `StreamingResponse` so peak backend RAM per
    request is bounded by chunk_size (default 1 MB), independent of file size.
    """
    client = _get_client()
    if client is None:
        return None
    try:
        resp = client.get_object(Bucket=settings.s3_bucket, Key=key)
    except Exception as e:  # noqa: BLE001
        logger.warning("S3 download failed for %s: %s", key, e)
        return None

    body = resp["Body"]

    def _iter() -> Iterator[bytes]:
        try:
            while True:
                chunk = body.read(chunk_size)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                body.close()
            except Exception:  # noqa: BLE001
                pass

    return _iter()


def download_bytes(key: str) -> Optional[bytes]:
    """Read the whole object into memory. Use only for small objects — prefer
    `download_stream()` for attachment serving so large PPTXs don't pin RAM.
    """
    client = _get_client()
    if client is None:
        return None
    try:
        resp = client.get_object(Bucket=settings.s3_bucket, Key=key)
        return resp["Body"].read()
    except Exception as e:  # noqa: BLE001
        logger.warning("S3 download_bytes failed for %s: %s", key, e)
        return None


# ---------------------------------------------------------------------------
# For tests: reset singleton
# ---------------------------------------------------------------------------

def _reset_client_for_tests() -> None:
    """Test-only: clear cached client so a fresh one is built next call.

    Keeps unit tests isolated when they swap settings.s3_enabled.
    """
    global _client, _client_init_failed
    _client = None
    _client_init_failed = False
