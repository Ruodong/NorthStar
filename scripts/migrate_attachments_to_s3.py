"""Upload NorthStar attachments to S3 and mark confluence_attachment.s3_key.

Spec: .specify/features/s3-attachments/spec.md §FR-11..FR-14

Runs host-side (not in Docker): needs read access to data/attachments/ and
network access to the corp OSS2 endpoint (VPN).

Idempotent:
- For each row in confluence_attachment with s3_key IS NULL (or --force),
  read local file, HeadObject on S3, skip if size matches, else PUT.
- On successful PUT, update s3_key in PG.

VPN-tolerant:
- Retries EndpointConnectionError with exponential backoff.
- Bails out only after ENDPOINT_DEAD_TIMEOUT (default 15 min).

Usage:
    python scripts/migrate_attachments_to_s3.py           # full run
    python scripts/migrate_attachments_to_s3.py --dry-run # no uploads, no DB writes
    python scripts/migrate_attachments_to_s3.py --workers 10
    python scripts/migrate_attachments_to_s3.py --force   # re-upload even if s3_key set
"""
from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
import psycopg2
import psycopg2.extras
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError, EndpointConnectionError

log = logging.getLogger("migrate_s3")

# ── Config from environment (same vars backend reads) ────────────────────
S3_ENDPOINT = os.environ["S3_ENDPOINT"]
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
S3_ACCESS_KEY = os.environ["S3_ACCESS_KEY"]
S3_SECRET_KEY = os.environ["S3_SECRET_KEY"]
S3_BUCKET = os.environ["S3_BUCKET"]
S3_PREFIX = os.environ.get("S3_PREFIX", "pm/northstar/attachments").rstrip("/")

ATTACHMENT_ROOT = Path(
    os.environ.get("ATTACHMENT_ROOT", "data/attachments")
).resolve()

PG_DSN = os.environ.get(
    "POSTGRES_DSN",
    "postgresql://northstar:northstar_dev@localhost:5434/northstar",
)

# Retry policy
MAX_RETRIES = 20
INITIAL_BACKOFF = 5
MAX_BACKOFF = 60
ENDPOINT_DEAD_TIMEOUT = 900  # 15 min


# ── S3 plumbing ──────────────────────────────────────────────────────────

def make_client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        region_name=S3_REGION,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
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


_tls = threading.local()


def get_client():
    if not hasattr(_tls, "c"):
        _tls.c = make_client()
    return _tls.c


_endpoint_dead_since: float | None = None
_dead_lock = threading.Lock()


def _mark_dead():
    global _endpoint_dead_since
    with _dead_lock:
        if _endpoint_dead_since is None:
            _endpoint_dead_since = time.time()


def _mark_alive():
    global _endpoint_dead_since
    with _dead_lock:
        _endpoint_dead_since = None


def _endpoint_dead_for() -> float:
    with _dead_lock:
        return 0 if _endpoint_dead_since is None else (time.time() - _endpoint_dead_since)


def _dns_ok(host: str) -> bool:
    try:
        socket.gethostbyname(host)
        return True
    except socket.gaierror:
        return False


def _call_with_retry(op, *, is_head=False, label=""):
    """Run op() with backoff. Transient endpoint/network errors retry,
    ClientError 404 on HEAD bubbles up so callers can detect missing objects."""
    from urllib.parse import urlparse
    host = urlparse(S3_ENDPOINT).hostname or ""
    for attempt in range(MAX_RETRIES):
        try:
            r = op()
            _mark_alive()
            return r
        except EndpointConnectionError:
            _mark_dead()
            if _endpoint_dead_for() > ENDPOINT_DEAD_TIMEOUT:
                raise
            backoff = min(INITIAL_BACKOFF * (2 ** attempt), MAX_BACKOFF)
            slept = 0
            while slept < backoff:
                time.sleep(2)
                slept += 2
                if _dns_ok(host):
                    if hasattr(_tls, "c"):
                        del _tls.c
                    break
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if is_head and code in ("404", "NoSuchKey", "NotFound"):
                raise
            if code in ("InternalError", "ServiceUnavailable", "SlowDown", "RequestTimeout"):
                time.sleep(min(INITIAL_BACKOFF * (2 ** attempt), MAX_BACKOFF))
                continue
            raise
    raise RuntimeError(f"Max retries for {label}")


# ── Per-file worker ──────────────────────────────────────────────────────

def process_one(row: dict, *, dry_run: bool) -> tuple[str, str, str | None, str | None]:
    """Upload if needed; return (attachment_id, status, new_s3_key, err).

    status: skip | uploaded | missing_local | error
    """
    attachment_id = row["attachment_id"]
    local_name = Path(row["local_path"] or "").name
    if not local_name:
        return (attachment_id, "missing_local", None, "no local_path in DB")
    src = ATTACHMENT_ROOT / local_name
    if not src.exists():
        return (attachment_id, "missing_local", None, f"{src} not on disk")
    size_local = src.stat().st_size
    key = f"{S3_PREFIX}/{local_name}"

    # HEAD check for idempotency
    try:
        head = _call_with_retry(
            lambda: get_client().head_object(Bucket=S3_BUCKET, Key=key),
            is_head=True, label=local_name,
        )
        if head["ContentLength"] == size_local:
            return (attachment_id, "skip", key, None)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code", "") not in ("404", "NoSuchKey", "NotFound"):
            return (attachment_id, "error", None, f"head: {e}")
    except Exception as e:  # noqa: BLE001
        return (attachment_id, "error", None, f"head: {e}")

    if dry_run:
        return (attachment_id, "would_upload", key, None)

    # Upload
    try:
        data = src.read_bytes()
        _call_with_retry(
            lambda: get_client().put_object(
                Bucket=S3_BUCKET, Key=key, Body=data, ContentLength=len(data),
                ContentType=row.get("media_type") or "application/octet-stream",
            ),
            label=local_name,
        )
        return (attachment_id, "uploaded", key, None)
    except Exception as e:  # noqa: BLE001
        return (attachment_id, "error", None, f"upload: {e}")


# ── DB helpers ──────────────────────────────────────────────────────────

def fetch_worklist(conn, force: bool) -> list[dict]:
    sql = """
        SELECT attachment_id, title, media_type, local_path, s3_key
          FROM northstar.confluence_attachment
         WHERE local_path IS NOT NULL
    """
    if not force:
        sql += " AND s3_key IS NULL"
    sql += " ORDER BY attachment_id"
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]


def update_s3_key(conn, attachment_id: str, s3_key: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE northstar.confluence_attachment SET s3_key = %s WHERE attachment_id = %s",
            (s3_key, attachment_id),
        )


# ── Main ────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true",
                        help="Re-upload even if s3_key is already set")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    log.info("source: %s", ATTACHMENT_ROOT)
    log.info("target: s3://%s/%s/", S3_BUCKET, S3_PREFIX)
    log.info("db:     %s", PG_DSN.rsplit("@", 1)[-1])
    if args.dry_run:
        log.info("DRY-RUN — no uploads, no DB writes")

    conn = psycopg2.connect(PG_DSN)
    conn.autocommit = True

    worklist = fetch_worklist(conn, force=args.force)
    total = len(worklist)
    if total == 0:
        log.info("nothing to do — all rows already have s3_key")
        return 0
    log.info("worklist: %d attachments", total)

    counts = {"skip": 0, "uploaded": 0, "would_upload": 0, "error": 0, "missing_local": 0}
    start = time.time()
    last_print = start
    done = 0

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(process_one, r, dry_run=args.dry_run): r["attachment_id"]
                   for r in worklist}
        for fut in as_completed(futures):
            aid, status, s3_key, err = fut.result()
            counts[status] += 1
            if status in ("uploaded", "skip") and not args.dry_run and s3_key:
                try:
                    update_s3_key(conn, aid, s3_key)
                except Exception as e:  # noqa: BLE001
                    log.warning("DB update failed for %s: %s", aid, e)
            if err:
                log.warning("%s: %s", aid, err)
            done += 1
            now = time.time()
            if now - last_print >= 3 or done == total:
                elapsed = now - start
                rate = done / elapsed if elapsed else 0
                eta = (total - done) / rate if rate else 0
                log.info(
                    "[%d/%d %.1f%%] skip=%d up=%d err=%d miss=%d eta=%.0fs",
                    done, total, 100 * done / total,
                    counts["skip"], counts["uploaded"],
                    counts["error"], counts["missing_local"], eta,
                )
                last_print = now

    conn.close()
    log.info("done. counts=%s", counts)
    return 0 if counts["error"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
