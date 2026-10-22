"""Uploads an encrypted database backup to Cloudflare R2 and deletes old ones.
Keeps: every daily backup for 30 days, plus the one from the 1st of each month for 12 months.
Usage: python tools/backup_r2.py <file>        (env: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

import boto3

PREFIX = "backups/db/"


def keep(name: str, today: date) -> bool:
    try:
        d = datetime.strptime(name[len(PREFIX):len(PREFIX) + 10], "%Y-%m-%d").date()
    except ValueError:
        return True   # not ours: leave it alone
    if today - d <= timedelta(days=30):
        return True
    return d.day == 1 and today - d <= timedelta(days=366)


def main(path: str):
    s3 = boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"], aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                      aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
    bucket = os.environ["R2_BUCKET"]
    today = datetime.now(timezone.utc).date()
    key = f"{PREFIX}{today.isoformat()}-{os.path.basename(path)}"
    s3.upload_file(path, bucket, key, ExtraArgs={"ContentType": "application/octet-stream"})
    print(f"Uploaded {key} ({os.path.getsize(path) / 1e6:.1f} MB)")
    removed = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX):
        for o in page.get("Contents", []):
            if not keep(o["Key"], today):
                s3.delete_object(Bucket=bucket, Key=o["Key"])
                removed += 1
    print(f"Removed {removed} old backup file(s)")


if __name__ == "__main__":
    main(sys.argv[1])
