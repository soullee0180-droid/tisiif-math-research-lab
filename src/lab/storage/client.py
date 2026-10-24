import hashlib
import hmac
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4
from datetime import datetime, timezone
import httpx
from lab.config import settings
from lab.db import insert, one

class Storage:
    def __init__(self):
        self.cfg = settings()
        if self.cfg.local_storage_dir and self.cfg.app_env not in ("test",):
            raise RuntimeError("LOCAL_STORAGE_TEST_ONLY")
        self.local = Path(self.cfg.local_storage_dir) if self.cfg.local_storage_dir else None
        self.headers = {"apikey": self.cfg.supabase_server_secret,
                        "Authorization": "Bearer " + self.cfg.supabase_server_secret}

    def path(self, bucket, name):
        if bucket not in ("lab-source","lab-prepared","lab-artifacts","lab-exports"):
            raise ValueError("INVALID_BUCKET")
        if name.startswith("/") or ".." in name.split("/"): raise ValueError("INVALID_OBJECT_PATH")
        return quote(bucket + "/" + name, safe="/")

    def request(self, method, path, **kwargs):
        headers = kwargs.pop('headers', self.headers)
        with httpx.Client(timeout=120) as client:
            r = client.request(method, self.cfg.supabase_url + "/storage/v1" + path,
                               headers=headers, **kwargs)
            r.raise_for_status()
            return r

    def put(self, bucket, name, data, mime):
        path = self.path(bucket, name)
        if self.local:
            p = self.local / path
            p.parent.mkdir(parents=True, exist_ok=True)
            if p.exists():
                if p.read_bytes() == data: return
                raise ValueError("IMMUTABLE_OBJECT_EXISTS")
            p.write_bytes(data)
            return
        self.request("POST", "/object/" + path, content=data,
                     headers={**self.headers, "Content-Type": mime, "x-upsert": "false"})

    def get(self, asset):
        path = self.path(asset["bucket"],asset["object_path"])
        if self.local: return (self.local / path).read_bytes()
        return self.request("GET", "/object/" + path).content

    def signed_upload(self, asset):
        path = self.path(asset["bucket"], asset["object_path"])
        if self.local:
            return {"upload_endpoint": "/api/v1/test-upload/" + str(asset["id"]),
                    "signed_upload_token": self.test_signature(asset)}
        data = self.request("POST", "/object/upload/sign/" + path, json={"upsert": False}).json()
        token = data.get("token")
        if not token:
            from urllib.parse import urlparse, parse_qs
            token = parse_qs(urlparse(data["url"]).query)["token"][0]
        host = self.cfg.supabase_url.replace(".supabase.co", ".storage.supabase.co")
        return {"upload_endpoint": host + "/storage/v1/upload/resumable", "signed_upload_token": token}

    def test_signature(self, asset):
        return hmac.new(self.cfg.test_auth_secret.encode(), str(asset["id"]).encode(), hashlib.sha256).hexdigest()

    def signed_download(self, asset):
        path = self.path(asset["bucket"],asset["object_path"])
        if self.local:
            return {"url": "/api/v1/test-download/" + str(asset["id"]) + "?signature=" + self.test_signature(asset),
                    "expires_in": 60}
        data = self.request("POST", "/object/sign/" + path, json={"expiresIn": 60}).json()
        return {"url": self.cfg.supabase_url + "/storage/v1" + data["signedURL"], "expires_in": 60}

    def save_asset(self, conn, user, kind, data, filename, mime, bucket=None):
        bucket = bucket or ("lab-prepared" if kind in ("prepared_pdf","page_png") else
                            "lab-exports" if kind in ("export","research_backup") else "lab-artifacts")
        ident = uuid4()
        name = str(user["workspace_id"]) + "/" + str(ident) + "/" + filename
        # Asset reservation is committed by the enclosing caller before provider dispatch when needed.
        row = insert(conn, "lab.assets", dict(id=ident, workspace_id=user["workspace_id"],
            kind=kind, bucket=bucket, object_path=name, original_name=filename, mime_type=mime,
            sha256=hashlib.sha256(data).hexdigest(), byte_size=len(data), status="verified",
            created_by=user["user_id"], verified_at=datetime.now(timezone.utc)))
        self.put(bucket, name, data, mime)
        return row

