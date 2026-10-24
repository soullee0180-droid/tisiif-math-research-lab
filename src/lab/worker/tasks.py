import io
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo
from lab.config import settings
from lab.db import transaction, one, many, insert, update, value
from lab.domain.research import canonical, digest, input_hash
from lab.storage.client import Storage
from lab.pdf.prepare import inspect_pdf, sanitize
from lab.api.papers import preparation_fingerprint

def finish(job,result):
    with transaction() as conn:
        conn.execute("update lab.jobs set status='completed',payload=payload||%s,lease_owner=null,lease_expires_at=null,updated_at=now() where workspace_id=%s and id=%s",
                     (value({"result":result}),job["workspace_id"],job["id"]))

def process_aux(job):
    ws=job["workspace_id"];payload=job["payload"];actor={"workspace_id":ws,"user_id":payload["actor_id"]}
    storage=Storage()
    if job["phase"]=="prepare_pdf":
        if payload["action"]=="verify_source":
            with transaction() as conn:
                source=one(conn,"select * from lab.assets where workspace_id=%s and id=%s",(ws,payload["asset_id"]))
            try:
                raw=storage.get(source)
                if len(raw)!=source["byte_size"] or len(raw)>104857600:raise ValueError("PDF_SIZE_MISMATCH")
                count=inspect_pdf(raw)
            except Exception:
                with transaction() as conn:conn.execute("update lab.assets set status='failed' where workspace_id=%s and id=%s",(ws,source["id"]))
                raise
            with transaction() as conn:
                duplicate=one(conn,"""select p.id,p.code from lab.papers p join lab.assets a on a.id=p.source_asset_id
                    where p.workspace_id=%s and a.sha256=%s and a.id<>%s and a.status='verified' limit 1""",(ws,digest(raw),source["id"]))
                conn.execute("update lab.assets set status='verified',sha256=%s,page_count=%s,verified_at=now() where workspace_id=%s and id=%s",
                             (digest(raw),count,ws,source["id"]))
            finish(job,{"page_count":count,"duplicate_paper":duplicate})
            return
        with transaction() as conn:
            rev=one(conn,"select * from lab.checkpoint_revisions where workspace_id=%s and id=%s",(ws,payload["revision_id"]))
            source=one(conn,"select * from lab.assets where workspace_id=%s and id=%s",(ws,rev["source_asset_id"]))
        data=sanitize(storage.get(source),rev["page_recipe"])
        asset=storage.persist(actor,"prepared_pdf",data,
            "context_"+str(rev["checkpoint_id"])+"_v"+str(rev["version_no"])+".pdf","application/pdf")
        count=inspect_pdf(data)
        with transaction() as conn:
            current=one(conn,"select * from lab.checkpoint_revisions where workspace_id=%s and id=%s for update",(ws,rev["id"]))
            if current["status"]=="approved" or preparation_fingerprint(current)!=payload["preparation_fingerprint"]:
                raise ValueError("STALE_PDF_PREPARATION")
            conn.execute("update lab.assets set page_count=%s where workspace_id=%s and id=%s",(count,ws,asset["id"]))
            current["prepared_asset_id"]=asset["id"]
            update(conn,"lab.checkpoint_revisions",rev["id"],ws,dict(status="review",prepared_asset_id=asset["id"],
                public_input_sha256=input_hash(current,asset)))
        finish(job,{"asset_id":asset["id"],"page_count":count})
        return
    if job["phase"]=="diagnostic":
        diagnostic(job,actor)
        return
    if job["phase"]=="export":
        from lab.export.archive import write_excel,write_archive
        from lab.export.analysis import selected_runs
        with transaction() as conn:
            export=one(conn,"select * from lab.exports where workspace_id=%s and id=%s",(ws,payload["export_id"]))
            conn.execute("update lab.exports set status='running' where workspace_id=%s and id=%s",(ws,export["id"]))
        try:
            with tempfile.TemporaryDirectory() as d:
                root=Path(d)
                companion=None
                if export["kind"]=="xlsx":
                    with transaction() as conn:
                        conn.execute("set transaction isolation level repeatable read, read only")
                        rows=selected_runs(conn,actor,export["filters"])
                        reviews=many(conn,"select * from lab.human_reviews where workspace_id=%s",(ws,))
                    texts={};path=root/"results.xlsx"
                    n=write_excel(rows,reviews,path,texts)
                    if n:
                        import zipfile
                        longpath=root/"long-text.zip"
                        with zipfile.ZipFile(longpath,"w",zipfile.ZIP_DEFLATED) as z:
                            for name,blob in texts.items():z.writestr(name,blob)
                        companion=storage.persist_path(actor,"export",longpath,"long-text.zip","application/zip")
                    asset=storage.persist_path(actor,"export",path,"results.xlsx",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                else:
                    path=root/"research.zip"
                    write_archive(actor,export["filters"],path,include_source=payload.get("include_source",True),
                                  external=export["kind"]=="external_zip")
                    asset=storage.persist_path(actor,"export",path,"research.zip","application/zip")
            with transaction() as conn:
                conn.execute("update lab.exports set status='completed',asset_id=%s,metadata=%s where workspace_id=%s and id=%s",
                    (asset["id"],value({"companion_asset_id":str(companion["id"]) if companion else None}),ws,export["id"]))
            finish(job,{"asset_id":asset["id"],"companion_asset_id":companion["id"] if companion else None})
        except Exception:
            with transaction() as conn:conn.execute("update lab.exports set status='failed' where workspace_id=%s and id=%s",(ws,export["id"]))
            raise
        return
    if job["phase"]=="backup":
        from lab.export.archive import write_archive,verify_archive,restore_archive
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"backup.zip"
            if payload.get("action")=="restore":
                with transaction() as conn:asset=one(conn,"select * from lab.assets where workspace_id=%s and id=%s",(ws,payload["asset_id"]))
                storage.download_to(asset,path)
                manifest=verify_archive(path)
                if digest(manifest)!=payload["manifest_hash"]:raise ValueError("RESTORE_MANIFEST_CHANGED")
                result=restore_archive(path,actor)
                with transaction() as conn:
                    insert(conn,"lab.audit_events",dict(workspace_id=ws,actor_id=actor["user_id"],action="workspace.restore.verified",
                        object_type="workspace",object_id=result["workspace_id"],safe_detail=result))
                    conn.execute("update lab.backup_runs set restored_test_at=now() where workspace_id=%s and metadata->>'asset_id'=%s",(ws,str(asset["id"])))
                finish(job,result)
                return
            with transaction() as conn:
                run=insert(conn,"lab.backup_runs",dict(id=uuid4(),workspace_id=ws,status="running",destination="lab-exports + worker disk"))
            try:
                manifest=write_archive(actor,{},path,include_source=payload.get("include_source",True),backup=True)
                verify_archive(path)
                asset=storage.persist_path(actor,"research_backup",path,"research-backup.zip","application/zip")
                # A second durable copy is separate from the Supabase project.
                backup_dir=Path(settings().backup_dir);backup_dir.mkdir(parents=True,exist_ok=True)
                import shutil
                local=backup_dir/(datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")+"_"+str(run["id"])+".zip")
                shutil.copyfile(path,local)
                with local.open("rb") as f:
                    import hashlib
                    sha=hashlib.file_digest(f,"sha256").hexdigest()
                if sha!=asset["sha256"]:raise ValueError("LOCAL_BACKUP_HASH_MISMATCH")
                for old in sorted(backup_dir.glob("*.zip"),key=lambda p:p.stat().st_mtime,reverse=True)[3:]:
                    old.unlink()
                with transaction() as conn:
                    conn.execute("update lab.backup_runs set status='completed',manifest_sha256=%s,byte_size=%s,finished_at=now(),metadata=%s where workspace_id=%s and id=%s",
                        (digest(manifest),asset["byte_size"],value({"asset_id":str(asset["id"]),"local_copy_hash":sha}),ws,run["id"]))
                finish(job,{"asset_id":asset["id"],"manifest_hash":digest(manifest)})
            except Exception:
                with transaction() as conn:conn.execute("update lab.backup_runs set status='failed',error_message='백업 생성 실패',finished_at=now() where workspace_id=%s and id=%s",(ws,run["id"]))
                raise
        return
    raise ValueError("UNSUPPORTED_AUXILIARY_PHASE")

def diagnostic(job,actor):
    from lab.providers.adapters import Adapter
    from lab.providers.secrets import decrypt
    from lab.pdf.prepare import inspect_pdf
    from reportlab.pdfgen import canvas
    ws=actor["workspace_id"]
    with transaction() as conn:
        profile=one(conn,"select * from lab.model_profiles where workspace_id=%s and id=%s",(ws,job["payload"]["profile_id"]))
        secret=one(conn,"select * from lab_private.provider_secrets where workspace_id=%s and provider=%s",(ws,profile["provider"]))
    b=io.BytesIO();c=canvas.Canvas(b);c.drawString(60,750,"Synthetic connection check: return {ok: true}.");c.save()
    packet={"stage":"select","model_snapshot":profile,"system_text":"Return only JSON matching the schema. No tools.",
            "user_text":"Return an object whose ok field is true. This is a synthetic connection test.",
            "response_schema":{"type":"object","properties":{"ok":{"type":"boolean","enum":[True]}},"required":["ok"],"additionalProperties":False}}
    req=Storage().persist(actor,"request_json",canonical(packet).encode(),"diagnostic-request.json","application/json")
    # One actual inference call, outside DB transactions. No automatic retry.
    response=Adapter(profile["provider"],decrypt(secret)).send(packet,b.getvalue() if profile["capabilities"].get("pdf_supported") else None)
    raw=Storage().persist(actor,"response_json",canonical({"raw":response.raw,"text":response.text,
        "model":response.model,"usage":response.usage,"request_id":response.request_id,"finish":response.finish}).encode(),
        "diagnostic-response.json","application/json")
    passed=response.finish=="stop" and json.loads(response.text)=={"ok":True}
    with transaction() as conn:
        conn.execute("update lab.model_profiles set verification_status=%s,verified_at=now() where workspace_id=%s and id=%s",
                     ("passed" if passed else "failed",ws,profile["id"]))
        conn.execute("update lab_private.provider_runtime set metadata=metadata||%s where provider=%s",
            (value({"last_success_at":datetime.now(timezone.utc).isoformat() if passed else None,
                    "last_check_scope":"synthetic_json_pdf" if profile["capabilities"].get("pdf_supported") else "synthetic_json"}),
             profile["provider"]))
    if not passed:raise ValueError("DIAGNOSTIC_RESPONSE_INVALID")
    finish(job,{"passed":True,"request_asset_id":req["id"],"response_asset_id":raw["id"],
                "scope":"synthetic_json_pdf" if profile["capabilities"].get("pdf_supported") else "synthetic_json",
                "full_research_path_verified":False})

def schedule_backup():
    cfg=settings()
    now=datetime.now(ZoneInfo("Asia/Seoul"))
    if now.hour<3:return
    with transaction() as conn:
        conn.execute("select pg_advisory_xact_lock(983202)")
        actor=one(conn,"select user_id from lab.workspace_members where workspace_id=%s and role='admin' and active limit 1",(cfg.default_workspace_id,))
        if not actor:return
        exists=one(conn,"""select id from lab.jobs where workspace_id=%s and phase='backup'
            and payload->>'action' is distinct from 'restore'
            and (created_at at time zone 'Asia/Seoul')::date=%s limit 1""",(cfg.default_workspace_id,now.date()))
        if exists:return
        insert(conn,"lab.jobs",dict(workspace_id=cfg.default_workspace_id,phase="backup",status="queued",
            payload={"actor_id":str(actor["user_id"]),"include_source":True,"scheduled":True}))

