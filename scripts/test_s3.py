#!/usr/bin/env python3
"""S3 connectivity + performance benchmark.

Reads S3_* env vars (same vars as EGM) and exercises:
  - head_bucket
  - list_objects (a few keys in a test prefix)
  - put_object (write a benchmark file)
  - get_object (read it back, measure throughput)
  - delete_object

Compares against local disk read for the same file size.

Usage:
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/test_s3.py
"""
from __future__ import annotations

import os
import sys
import time
import tempfile
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig


def make_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        config=BotoConfig(
            s3={"addressing_style": "path"},
            signature_version="s3",
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def bench(name: str, fn, *args, **kwargs):
    t0 = time.perf_counter()
    result = fn(*args, **kwargs)
    dt = (time.perf_counter() - t0) * 1000
    print(f"  {name:28} {dt:>8.1f} ms")
    return result, dt


def main() -> int:
    bucket = os.environ["S3_BUCKET"]
    prefix = os.environ.get("S3_PREFIX", "pm/northstar/app").rstrip("/")
    endpoint = os.environ["S3_ENDPOINT"]

    print(f"endpoint: {endpoint}")
    print(f"bucket:   {bucket}")
    print(f"prefix:   {prefix}")
    print()

    client = make_client()

    print("=== 1. connectivity (head_bucket may be 403 if key is prefix-scoped) ===")
    try:
        _, _ = bench("head_bucket", client.head_bucket, Bucket=bucket)
    except Exception as exc:  # noqa: BLE001
        print(f"  head_bucket: {exc} (skipping, trying object-level access)")

    try:
        _, _ = bench(
            "list_objects_v2 (max 5)",
            lambda: client.list_objects_v2(Bucket=bucket, Prefix=prefix + "/", MaxKeys=5),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  list_objects: {exc} (skipping, trying direct put/get)")

    print()
    print("=== 2. put/get benchmarks (first call includes TLS handshake) ===")
    print("  size | put ms | put MB/s | get ms | get MB/s")
    print("  -----+--------+----------+--------+---------")
    for mb in (0.1, 1, 5, 10, 20):
        size = int(mb * 1024 * 1024)
        data = os.urandom(size)
        key = f"{prefix}/northstar-bench/{int(time.time())}-{mb}mb.bin"

        t0 = time.perf_counter()
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType="application/octet-stream",
            ContentLength=size,
        )
        up_ms = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        resp = client.get_object(Bucket=bucket, Key=key)
        body = resp["Body"].read()
        dl_ms = (time.perf_counter() - t0) * 1000
        assert len(body) == size

        up_mbps = mb / (up_ms / 1000) if up_ms > 0 else 0
        dl_mbps = mb / (dl_ms / 1000) if dl_ms > 0 else 0
        print(f"  {mb:>4}MB | {up_ms:>6.0f} | {up_mbps:>7.1f}  | {dl_ms:>6.0f} | {dl_mbps:>6.1f}")

        client.delete_object(Bucket=bucket, Key=key)

    print()
    print("=== 3. local disk read baseline (for comparison) ===")
    with tempfile.NamedTemporaryFile(delete=False) as f:
        tmp = Path(f.name)
    try:
        for mb in (1, 5, 10):
            size = int(mb * 1024 * 1024)
            tmp.write_bytes(os.urandom(size))
            t0 = time.perf_counter()
            _ = tmp.read_bytes()
            dt = (time.perf_counter() - t0) * 1000
            print(f"  local read  {mb:>3}MB  {dt:>7.1f} ms = {(size/1024/1024)/(dt/1000):>6.1f} MB/s")
    finally:
        tmp.unlink(missing_ok=True)

    print()
    print("=== 4. presigned URL generation ===")
    t0 = time.perf_counter()
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": f"{prefix}/northstar-bench/nonexistent"},
        ExpiresIn=300,
    )
    print(f"  generate_presigned_url  {(time.perf_counter()-t0)*1000:>7.1f} ms")
    print(f"  sample url: {url[:100]}...")
    print()
    print("DONE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
