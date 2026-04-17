"""Sample-verify S3 round-trip integrity for NorthStar attachments.

Spec: .specify/features/s3-attachments/spec.md §FR-15

Picks N random rows from confluence_attachment WHERE s3_key IS NOT NULL,
reads the corresponding local file, downloads from S3, compares SHA256.
Exits 0 on all-match, 1 on any mismatch.

Usage:
    python scripts/verify_s3_attachments.py              # 50 random samples
    python scripts/verify_s3_attachments.py --samples 200
    python scripts/verify_s3_attachments.py --seed 42    # reproducible sample
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
import random
import sys
import time
from pathlib import Path

import boto3
import psycopg2
import psycopg2.extras
from botocore.config import Config as BotoConfig

log = logging.getLogger("verify_s3")

S3_ENDPOINT = os.environ["S3_ENDPOINT"]
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
S3_ACCESS_KEY = os.environ["S3_ACCESS_KEY"]
S3_SECRET_KEY = os.environ["S3_SECRET_KEY"]
S3_BUCKET = os.environ["S3_BUCKET"]

ATTACHMENT_ROOT = Path(
    os.environ.get("ATTACHMENT_ROOT", "data/attachments")
).resolve()

PG_DSN = os.environ.get(
    "POSTGRES_DSN",
    "postgresql://northstar:northstar_dev@localhost:5434/northstar",
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--seed", type=int, default=None,
                        help="RNG seed for reproducible sampling")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    conn = psycopg2.connect(PG_DSN)
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(
            "SELECT attachment_id, title, local_path, s3_key "
            "FROM northstar.confluence_attachment WHERE s3_key IS NOT NULL"
        )
        rows = cur.fetchall()
    conn.close()

    if not rows:
        log.error("no rows with s3_key set — run migrate_attachments_to_s3.py first")
        return 1
    log.info("population: %d attachments on S3", len(rows))

    if args.seed is not None:
        random.seed(args.seed)
    sample = random.sample(list(rows), min(args.samples, len(rows)))
    log.info("sampling %d files for verification", len(sample))

    client = boto3.client(
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
            read_timeout=120,
        ),
    )

    ok = 0
    bad = 0
    missing_local = 0
    bytes_checked = 0
    t0 = time.time()

    for i, r in enumerate(sample, 1):
        aid = r["attachment_id"]
        local_name = Path(r["local_path"] or "").name
        local_path = ATTACHMENT_ROOT / local_name if local_name else None
        if not local_path or not local_path.exists():
            missing_local += 1
            log.warning("[%d/%d] MISSING LOCAL  %s", i, len(sample), aid)
            continue
        local_data = local_path.read_bytes()
        local_sha = sha256_bytes(local_data)
        try:
            resp = client.get_object(Bucket=S3_BUCKET, Key=r["s3_key"])
            s3_data = resp["Body"].read()
        except Exception as e:  # noqa: BLE001
            bad += 1
            log.warning("[%d/%d] S3 FAIL  %s: %s", i, len(sample), aid, e)
            continue
        s3_sha = sha256_bytes(s3_data)
        bytes_checked += len(s3_data)
        match = (len(local_data) == len(s3_data) and local_sha == s3_sha)
        if match:
            ok += 1
            log.info(
                "[%d/%d] OK   %s  size=%d  sha=%s",
                i, len(sample), aid, len(local_data), local_sha[:12],
            )
        else:
            bad += 1
            log.warning(
                "[%d/%d] BAD  %s  local_size=%d s3_size=%d  local_sha=%s s3_sha=%s",
                i, len(sample), aid, len(local_data), len(s3_data),
                local_sha[:12], s3_sha[:12],
            )

    elapsed = time.time() - t0
    mbps = bytes_checked / 1024 / 1024 / elapsed if elapsed else 0
    log.info(
        "summary: %d OK / %d BAD / %d missing_local (%.1f MB, %.1fs, %.1f MB/s)",
        ok, bad, missing_local, bytes_checked / 1024 / 1024, elapsed, mbps,
    )
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
