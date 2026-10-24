import argparse
import hashlib
import json
from pathlib import Path
from uuid import UUID,uuid4
import psycopg
from psycopg.rows import dict_row
from lab.config import ROOT,settings
from lab.domain.research import definition,digest
from lab.db import transaction,one,insert,value

def migrate():
    cfg=settings()
    if not cfg.database_url:raise RuntimeError("DATABASE_URL is required")
    with psycopg.connect(cfg.database_url,autocommit=True,row_factory=dict_row) as conn:
        conn.execute("select pg_advisory_lock(983200)")
        try:
            conn.execute("create schema if not exists lab_private")
            conn.execute("""create table if not exists lab_private.app_migrations(
                version text primary key,sha256 text not null,applied_at timestamptz not null default now(),adopted boolean not null default false)""")
            conn.execute("alter table lab_private.app_migrations enable row level security")
            conn.execute("revoke all on lab_private.app_migrations from public,anon,authenticated")
            files=sorted((ROOT/"supabase/migrations").glob("*.sql"))
            if not files:raise RuntimeError("MIGRATIONS_NOT_GENERATED")
            for path in files:
                body=path.read_text();sha=hashlib.sha256(path.read_bytes()).hexdigest()
                old=conn.execute("select * from lab_private.app_migrations where version=%s",(path.name,)).fetchone()
                if old:
                    if old["sha256"]!=sha:raise RuntimeError("APPLIED_MIGRATION_HASH_CHANGED")
                    continue
                adopted=False
                if path.name.endswith("_initial_research_contract.sql") and conn.execute("select to_regclass('lab.workspaces') table_name").fetchone()["table_name"]:
                    expected=json.loads((ROOT/"scripts/schema-columns.json").read_text())
                    actual=conn.execute("select table_schema,table_name,column_name from information_schema.columns where table_schema in ('lab','lab_private')").fetchall()
                    present={(r["table_schema"]+"."+r["table_name"],r["column_name"]) for r in actual}
                    if any((table,col) not in present for table,cols in expected.items() for col in cols):
                        raise RuntimeError("EXISTING_SCHEMA_DOES_NOT_MATCH_CONTRACT")
                    adopted=True
                if not adopted:conn.execute(body)
                conn.execute("insert into lab_private.app_migrations(version,sha256,adopted) values(%s,%s,%s)",(path.name,sha,adopted))
        finally:conn.execute("select pg_advisory_unlock(983200)")
    print(json.dumps({"migration":"complete","secrets_printed":False}))

def bootstrap():
    cfg=settings()
    if not cfg.bootstrap_admin_email:raise RuntimeError("BOOTSTRAP_ADMIN_EMAIL is required")
    admin=cfg.bootstrap_admin_email.strip().lower()
    with transaction() as conn:
        conn.execute("select pg_advisory_xact_lock(983203)")
        ws=one(conn,"select * from lab.workspaces where is_active")
        if not ws:
            ws=insert(conn,"lab.workspaces",{"id":UUID(cfg.default_workspace_id) if cfg.default_workspace_id else uuid4()})
        if cfg.default_workspace_id and str(ws["id"])!=cfg.default_workspace_id:
            raise RuntimeError("CONFIGURED_WORKSPACE_MISMATCH")
        # Existing allowlist changes are authoritative; environment seed never overwrites them.
        emails=[(admin,"admin")]+[(s.strip().lower(),"researcher") for s in cfg.team_email_allowlist.split(",") if s.strip() and s.strip().lower()!=admin]
        for email,role in emails:
            conn.execute("insert into lab_private.email_allowlist(workspace_id,email,role) values(%s,%s,%s) on conflict do nothing",(ws["id"],email,role))
        proto=one(conn,"select id from lab.protocol_versions where workspace_id=%s and name='TISIIF Math v1' and version_no=1",(ws["id"],))
        if not proto:
            data=definition()
            insert(conn,"lab.protocol_versions",dict(id=uuid4(),workspace_id=ws["id"],name="TISIIF Math v1",version_no=1,
                definition=data,sha256=digest(data),created_by=UUID(int=0)))
        for provider in ("google","openai","anthropic","mock"):
            conn.execute("""insert into lab_private.provider_runtime(provider,enabled,min_interval_seconds)
                values(%s,%s,%s) on conflict do nothing""",(provider,provider=="mock",0 if provider=="mock" else 2))
    print(json.dumps({"workspace_id":str(ws["id"]),"bootstrap":"complete","secrets_printed":False}))

def main():
    parser=argparse.ArgumentParser(prog="python -m lab.cli")
    sub=parser.add_subparsers(dest="command",required=True)
    for name in ("web","worker","migrate","bootstrap","check-config"):sub.add_parser(name)
    p=sub.add_parser("backup");p.add_argument("--workspace",required=True)
    p=sub.add_parser("restore");p.add_argument("--archive",required=True);p.add_argument("--target-new-workspace",action="store_true",required=True)
    p=sub.add_parser("smoke-test");p.add_argument("--provider",required=True);p.add_argument("--max-requests",type=int,choices=[1],required=True)
    args=parser.parse_args()
    if args.command=="migrate":migrate()
    elif args.command=="bootstrap":bootstrap()
    elif args.command=="check-config":print(json.dumps(settings().check()))
    elif args.command=="web":
        import uvicorn
        uvicorn.run("lab.api.app:app",host="0.0.0.0",port=settings().port,access_log=False)
    elif args.command=="worker":
        from lab.worker.engine import run_worker
        run_worker()
    elif args.command in ("backup","restore"):
        from lab.export.archive import restore_archive,write_archive
        with transaction() as conn:
            ws=args.workspace if args.command=="backup" else settings().default_workspace_id
            actor=one(conn,"select * from lab.workspace_members where workspace_id=%s and role='admin' and active limit 1",(ws,))
        if not actor:raise RuntimeError("ACTIVE_ADMIN_REQUIRED")
        if args.command=="backup":
            path=Path(settings().backup_dir)/("manual-"+str(uuid4())+".zip");path.parent.mkdir(parents=True,exist_ok=True)
            manifest=write_archive(actor,{},path,True,backup=True)
            print(json.dumps({"archive":str(path),"manifest_hash":digest(manifest)}))
        else:print(json.dumps(restore_archive(args.archive,actor)))
    elif args.command=="smoke-test":
        # Only a clearly authorized explicit CLI invocation may run one connection diagnostic.
        from lab.worker.tasks import diagnostic
        from lab.db import many
        with transaction() as conn:
            actor=one(conn,"select * from lab.workspace_members where workspace_id=%s and role='admin' and active limit 1",(settings().default_workspace_id,))
            profile=one(conn,"select * from lab.model_profiles where workspace_id=%s and provider=%s order by created_at desc limit 1",(settings().default_workspace_id,args.provider))
            runtime=one(conn,"select * from lab_private.provider_runtime where provider=%s",(args.provider,))
            if not actor or not profile or not runtime or not runtime["metadata"].get("eligibility_confirmed"):
                raise RuntimeError("SMOKE_TEST_PREREQUISITES_MISSING")
            job=insert(conn,"lab.jobs",dict(id=uuid4(),workspace_id=actor["workspace_id"],phase="diagnostic",status="leased",
                payload={"actor_id":str(actor["user_id"]),"profile_id":str(profile["id"]),"provider":args.provider,"max_requests":1}))
        diagnostic(job,actor)

if __name__=="__main__":main()

