import hashlib
import hmac
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4
from datetime import datetime, timezone
import httpx
from lab.config import settings
from lab.db import insert, one, transaction

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

    def persist(self, user, kind, data, filename, mime, bucket=None, ident=None):
        bucket = bucket or ('lab-prepared' if kind in ('prepared_pdf','page_png') else
            'lab-exports' if kind in ('export','research_backup') else 'lab-artifacts')
        ident = ident or uuid4()
        name = str(user['workspace_id'])+'/'+str(ident)+'/'+filename
        sha = hashlib.sha256(data).hexdigest()
        try:
            self.put(bucket,name,data,mime)
        except Exception:
            # A deterministic retry may encounter the identical already-written object.
            if hashlib.sha256(self.get({'bucket':bucket,'object_path':name})).hexdigest()!=sha:
                raise ValueError('IMMUTABLE_OBJECT_MISMATCH') from None
        with transaction() as conn:
            old=one(conn,'select * from lab.assets where id=%s and workspace_id=%s',(ident,user['workspace_id']))
            if old:
                if old['sha256']!=sha:raise ValueError('IMMUTABLE_ASSET_MISMATCH')
                return old
            return insert(conn,'lab.assets',dict(id=ident,workspace_id=user['workspace_id'],kind=kind,
                bucket=bucket,object_path=name,original_name=filename,mime_type=mime,sha256=sha,
                byte_size=len(data),status='verified',created_by=user['user_id'],verified_at=datetime.now(timezone.utc)))

    def download_to(self,asset,path):
        import shutil
        if self.local:
            shutil.copyfile(self.local/self.path(asset['bucket'],asset['object_path']),path)
        else:
            with httpx.Client(timeout=600) as client:
                with client.stream('GET',self.cfg.supabase_url+'/storage/v1/object/'+self.path(asset['bucket'],asset['object_path']),headers=self.headers) as r:
                    r.raise_for_status()
                    with open(path,'wb') as out:
                        for chunk in r.iter_bytes(1024*1024):out.write(chunk)
        h=hashlib.sha256()
        with open(path,'rb') as f:
            for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
        if asset.get('sha256') and h.hexdigest()!=asset['sha256']:
            raise ValueError('ASSET_HASH_MISMATCH')

    def persist_path(self,user,kind,path,filename,mime,bucket='lab-exports'):
        import shutil
        path=Path(path)
        ident=uuid4();name=str(user['workspace_id'])+'/'+str(ident)+'/'+filename
        h=hashlib.sha256()
        with path.open('rb') as f:
            for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
        if self.local:
            target=self.local/self.path(bucket,name);target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(path,target)
        else:
            with path.open('rb') as f:
                self.request('POST','/object/'+self.path(bucket,name),content=f,
                    headers={**self.headers,'Content-Type':mime,'Content-Length':str(path.stat().st_size),'x-upsert':'false'})
        with transaction() as conn:
            return insert(conn,'lab.assets',dict(id=ident,workspace_id=user['workspace_id'],kind=kind,
                bucket=bucket,object_path=name,original_name=filename,mime_type=mime,sha256=h.hexdigest(),
                byte_size=path.stat().st_size,status='verified',created_by=user['user_id'],verified_at=datetime.now(timezone.utc)))

