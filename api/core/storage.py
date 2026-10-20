"""Where processed layers live. Local folder for development; Cloudflare R2 (S3-compatible,
no egress fees) in production. Phones download tiles straight from the public URL."""
import os
from pathlib import Path


class LocalStore:
    def __init__(self, root: str):
        self.root = Path(root)
        self.public_base = os.environ.get("PUBLIC_DATA_URL", "/data")

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes | None:
        p = self.root / key
        return p.read_bytes() if p.exists() else None

    def url(self, key: str) -> str:
        return f"{self.public_base.rstrip('/')}/{key}"


class R2Store:
    def __init__(self):
        import boto3  # only needed in production
        self.bucket = os.environ["R2_BUCKET"]
        self.public_base = os.environ["PUBLIC_DATA_URL"]  # e.g. https://pub-xxxx.r2.dev
        self.s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        cache = "public, max-age=300" if key.startswith("manifests/") else "public, max-age=86400"
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type, CacheControl=cache)

    def get(self, key: str) -> bytes | None:
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.s3.exceptions.NoSuchKey:
            return None

    def url(self, key: str) -> str:
        return f"{self.public_base.rstrip('/')}/{key}"


_store = None


def get_store():
    global _store
    if _store is None:
        _store = R2Store() if os.environ.get("STORAGE", "local") == "r2" else LocalStore(os.environ.get("LOCAL_DATA_DIR", "data"))
    return _store
