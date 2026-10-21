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

    def delete_prefix(self, prefix: str) -> int:
        import shutil
        p = self.root / prefix
        if p.is_dir():
            n = sum(1 for _ in p.rglob("*") if _.is_file())
            shutil.rmtree(p)
            return n
        return 0


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
        except Exception as e:   # permissions / network: treat as missing, but say why in the server log
            print(f"storage: could not read {key}: {type(e).__name__}: {str(e)[:200]}")
            return None

    def delete_prefix(self, prefix: str) -> int:
        """Delete every object under a folder (old wind runs). Returns how many were removed."""
        n, token = 0, None
        while True:
            kw = {"Bucket": self.bucket, "Prefix": prefix, **({"ContinuationToken": token} if token else {})}
            page = self.s3.list_objects_v2(**kw)
            keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            for i in range(0, len(keys), 1000):
                self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": keys[i:i + 1000], "Quiet": True})
            n += len(keys)
            if not page.get("IsTruncated"):
                return n
            token = page.get("NextContinuationToken")

    def url(self, key: str) -> str:
        return f"{self.public_base.rstrip('/')}/{key}"


_store = None


def get_store():
    global _store
    if _store is None:
        _store = R2Store() if os.environ.get("STORAGE", "local") == "r2" else LocalStore(os.environ.get("LOCAL_DATA_DIR", "data"))
    return _store
