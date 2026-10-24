import base64
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, Request
from lab.api.auth import current_user
from lab.api.common import require_admin, get, fail
from lab.api.types import KeyBody, ProfileBody, RuntimeBody, MemberBody, ProtocolBody, TestBody, BackupBody, RestoreBody
from lab.api.papers import aux
from lab.db import transaction, one, many, insert, audit, value
from lab.config import settings
from lab.domain.research import digest, definition, PROVIDERS
from lab.providers.secrets import encrypt, decrypt
from lab.providers.adapters import Adapter, validate_profile
from lab.storage.client import Storage

router=APIRouter()
def admin_user(user=Depends(current_user)):
    require_admin(user);return user

@router.get("/admin/providers")
def providers(user=Depends(admin_user)):
    with transaction() as conn:
        runtimes=many(conn,"select * from lab_private.provider_runtime where provider<>'mock' order by provider")
        keys=many(conn,"select provider,last_four,key_version,updated_at from lab_private.provider_secrets where workspace_id=%s",(user["workspace_id"],))
        return {"items":[{**r,"key":next((k for k in keys if k["provider"]==r["provider"]),None)} for r in runtimes]}

@router.put("/admin/providers/{provider}/key")
def key(provider:str,body:KeyBody,user=Depends(admin_user)):
    if provider not in PROVIDERS:fail("INVALID_PROVIDER","제공사를 확인해 주세요.")
    ciphertext,nonce=encrypt(body.key,user["workspace_id"],provider)
    with transaction() as conn:
        conn.execute("""insert into lab_private.provider_secrets(workspace_id,provider,ciphertext,nonce,last_four,updated_by)
            values(%s,%s,%s,%s,%s,%s) on conflict(workspace_id,provider) do update set
            ciphertext=excluded.ciphertext,nonce=excluded.nonce,last_four=excluded.last_four,
            key_version=lab_private.provider_secrets.key_version+1,updated_by=excluded.updated_by,updated_at=now()""",
            (user["workspace_id"],provider,ciphertext,nonce,body.key.strip()[-4:],user["user_id"]))
        audit(conn,user,"provider.key.rotate","provider",None,{"provider":provider})
    return {"configured":True,"last_four":body.key.strip()[-4:]}

@router.get("/admin/providers/{provider}/models")
def list_models(provider:str,user=Depends(admin_user)):
    if provider not in PROVIDERS:fail("INVALID_PROVIDER","제공사를 확인해 주세요.")
    with transaction() as conn:
        secret=one(conn,"select * from lab_private.provider_secrets where workspace_id=%s and provider=%s",(user["workspace_id"],provider))
    if not secret:fail("KEY_REQUIRED","API 키를 먼저 입력해 주세요.")
    try:return {"items":Adapter(provider,decrypt(secret)).list_models(),"scope":"model_list_only"}
    except Exception:fail("MODEL_LIST_FAILED","모델 목록을 불러오지 못했습니다. 키와 접근 권한을 확인해 주세요.",502)

@router.post("/admin/model-profiles")
def profile(body:ProfileBody,user=Depends(admin_user)):
    row=body.model_dump(exclude={"manual_only"});validate_profile(row)
    for key in ("pdf_supported","structured_output_supported","official_source_url"):
        if key not in body.capabilities:fail("CAPABILITIES_REQUIRED","모델 지원 조건과 공식 출처를 입력해 주세요.")
    with transaction() as conn:
        result=insert(conn,"lab.model_profiles",{**row,"id":uuid4(),"workspace_id":user["workspace_id"],
            "verification_status":"manual_only" if body.manual_only else "unverified","created_by":user["user_id"]})
        audit(conn,user,"model_profile.create","model_profile",result["id"])
        return result

@router.post("/admin/providers/{provider}/test")
def test_provider(provider:str,body:TestBody,user=Depends(admin_user)):
    if provider not in PROVIDERS:fail("INVALID_PROVIDER","제공사를 확인해 주세요.")
    with transaction() as conn:
        profile=get(conn,"model_profiles",body.profile_id,user["workspace_id"])
        if profile["provider"]!=provider:fail("PROFILE_PROVIDER_MISMATCH","제공사가 일치하지 않습니다.")
        runtime=one(conn,"select * from lab_private.provider_runtime where provider=%s",(provider,))
        if not runtime["metadata"].get("eligibility_confirmed"):
            fail("ELIGIBILITY_UNCONFIRMED","제공사 이용 조건을 먼저 확인해 주세요.")
        if not one(conn,"select 1 from lab_private.provider_secrets where workspace_id=%s and provider=%s",(user["workspace_id"],provider)):
            fail("KEY_REQUIRED","API 키를 먼저 설정해 주세요.")
        job=aux(conn,user,"diagnostic",{"profile_id":str(profile["id"]),"provider":provider,"max_requests":1})
        audit(conn,user,"provider.diagnostic.request","job",job["id"],{"provider":provider,"max_requests":1})
        return {"job_id":job["id"],"scope":"one_synthetic_pdf_json_request"}

@router.patch("/admin/providers/{provider}/runtime")
def runtime(provider:str,body:RuntimeBody,user=Depends(admin_user)):
    if provider not in PROVIDERS and provider!="mock":fail("INVALID_PROVIDER","제공사를 확인해 주세요.")
    with transaction() as conn:
        old=one(conn,"select * from lab_private.provider_runtime where provider=%s for update",(provider,))
        if not old:fail("NOT_FOUND","제공사를 찾을 수 없습니다.",404)
        metadata=old["metadata"]
        if body.eligibility_confirmed is not None:
            metadata={**metadata,"eligibility_confirmed":body.eligibility_confirmed,
                      "eligibility_checked_by":str(user["user_id"]),"eligibility_checked_at":datetime.now(timezone.utc).isoformat()}
        conn.execute("""update lab_private.provider_runtime set enabled=%s,max_concurrency=%s,
            min_interval_seconds=%s,rpm_limit=%s,tpm_limit=%s,metadata=%s,
            blocked_reason=case when %s then null else blocked_reason end,
            paused_until=case when %s then null else paused_until end where provider=%s""",
            (body.enabled,body.max_concurrency,body.min_interval_seconds,body.rpm_limit,body.tpm_limit,
             value(metadata),body.clear_block,body.clear_block,provider))
        if body.clear_block:
            conn.execute("""update lab.jobs set status='queued',error_class=null,error_message=null,available_at=now()
                where workspace_id=%s and provider=%s and status='blocked'
                and error_class in ('credential_blocked','payment_blocked','permission_blocked','spend_blocked','quota_unknown','quota_daily')
                and not exists(select 1 from unnest(depends_on) d(id) left join lab.jobs x on x.id=d.id where x.id is null or x.status<>'completed')""",(user["workspace_id"],provider))
        audit(conn,user,"provider.runtime.update","provider",None,{"provider":provider,**body.model_dump()})
        return {"provider":provider,"updated":True}

@router.get("/admin/protocols")
def protocols(user=Depends(admin_user)):
    with transaction() as conn:return {"items":many(conn,"select * from lab.protocol_versions where workspace_id=%s order by created_at desc",(user["workspace_id"],))}

@router.post("/admin/protocols")
def protocol(body:ProtocolBody,user=Depends(admin_user)):
    data=body.definition
    if not 1<=data.get("candidate_count",0)<=10 or not 1<=data.get("independent_repeats",0)<=10:
        fail("INVALID_PROTOCOL","후보 수와 반복 수는 1부터 10까지입니다.")
    if set(data.get("prompts",{}))!={"generate","select","usefulness","agreement"}:
        fail("FOUR_PROMPTS_REQUIRED","네 단계의 연구 질문이 모두 필요합니다.")
    from jsonschema import Draft202012Validator
    from lab.domain.research import schema_for
    for phase in ("generate","select","usefulness","agreement"):
        Draft202012Validator.check_schema(schema_for(data,phase,data["candidate_count"]))
        has_reference="{{REFERENCE}}" in data["prompts"][phase]["user_template"]
        if has_reference != (phase=="agreement"):fail("REFERENCE_BOUNDARY","기준 아이디어 전송 경계를 확인해 주세요.")
    data={**data,"judges":"the other two providers; no self-judging","external_tools":[],"web_search":False,"code_execution":False}
    with transaction() as conn:
        conn.execute("select pg_advisory_xact_lock(hashtextextended(%s,2))",(str(user["workspace_id"]),))
        n=one(conn,"select coalesce(max(version_no),0)+1 n from lab.protocol_versions where workspace_id=%s and name=%s",(user["workspace_id"],body.name))["n"]
        row=insert(conn,"lab.protocol_versions",dict(id=uuid4(),workspace_id=user["workspace_id"],name=body.name,
            version_no=n,definition=data,sha256=digest(data),created_by=user["user_id"]))
        audit(conn,user,"protocol.create","protocol",row["id"],{"reason":body.change_reason})
        return row

@router.get("/admin/members")
def members(user=Depends(admin_user)):
    with transaction() as conn:
        return {"items":many(conn,"""select a.email,a.role,a.active,m.user_id,m.display_name,m.joined_at
            from lab_private.email_allowlist a left join lab.workspace_members m
            on m.workspace_id=a.workspace_id and m.email=a.email where a.workspace_id=%s order by a.role,a.email""",(user["workspace_id"],))}

@router.patch("/admin/members")
def member(body:MemberBody,user=Depends(admin_user)):
    email=body.email.strip().lower()
    if not email or "@" not in email or len(email)>320:fail("INVALID_EMAIL","이메일을 확인해 주세요.")
    with transaction() as conn:
        conn.execute("select pg_advisory_xact_lock(hashtextextended(%s,3))",(str(user["workspace_id"]),))
        admins=many(conn,"select email from lab_private.email_allowlist where workspace_id=%s and role='admin' and active",(user["workspace_id"],))
        if any(a["email"]==email for a in admins) and len(admins)==1 and (not body.active or body.role!="admin"):
            fail("LAST_ADMIN_REQUIRED","마지막 관리자는 비활성화할 수 없습니다.",409)
        conn.execute("""insert into lab_private.email_allowlist(workspace_id,email,role,active,updated_by)
            values(%s,%s,%s,%s,%s) on conflict(workspace_id,email) do update set
            role=excluded.role,active=excluded.active,updated_by=excluded.updated_by,updated_at=now()""",
            (user["workspace_id"],email,body.role,body.active,user["user_id"]))
        conn.execute("update lab.workspace_members set role=%s,active=%s where workspace_id=%s and email=%s",
                     (body.role,body.active,user["workspace_id"],email))
        audit(conn,user,"member.update","member",None,{"email":email,"role":body.role,"active":body.active})
        return {"email":email,"updated":True}

@router.get("/team")
def team(user=Depends(current_user)):
    with transaction() as conn:
        return {"items":many(conn,"select user_id,display_name,role from lab.workspace_members where workspace_id=%s and active order by display_name",(user["workspace_id"],))}

@router.get("/protocols")
def member_protocols(user=Depends(current_user)):
    with transaction() as conn:return {"items":many(conn,"select * from lab.protocol_versions where workspace_id=%s order by created_at desc",(user["workspace_id"],))}

@router.get("/admin/health")
def health(user=Depends(admin_user)):
    cfg=settings()
    with transaction() as conn:
        beats=many(conn,"select * from lab.worker_heartbeats where workspace_id=%s",(user["workspace_id"],))
        backup=one(conn,"select * from lab.backup_runs where workspace_id=%s order by started_at desc limit 1",(user["workspace_id"],))
        restore=one(conn,"select created_at,safe_detail from lab.audit_events where workspace_id=%s and action='workspace.restored' order by created_at desc limit 1",(user["workspace_id"],))
        buckets=many(conn,"select id,public,file_size_limit from storage.buckets where id=any(%s)",(["lab-source","lab-prepared","lab-artifacts","lab-exports"],))
    return {"build_sha":cfg.build_sha or None,"database":True,"settings_present":cfg.check(),"heartbeats":beats,
            "latest_backup":backup,"latest_restore":restore,"buckets":buckets,"independent_copy":"별도 보관 확인 필요"}

@router.post("/admin/backups")
def backup(body:BackupBody,user=Depends(admin_user)):
    with transaction() as conn:
        job=aux(conn,user,"backup",{"include_source":body.include_source})
        audit(conn,user,"backup.request","job",job["id"])
        return {"job_id":job["id"]}

@router.post("/admin/restore-preflight")
def restore_preflight(body:RestoreBody,user=Depends(admin_user)):
    from lab.export.archive import verify_archive
    with transaction() as conn:asset=get(conn,"assets",body.asset_id,user["workspace_id"])
    if asset["kind"]!="research_backup":fail("RESEARCH_BACKUP_REQUIRED","연구 백업 파일을 선택해 주세요.")
    with tempfile.TemporaryDirectory() as d:
        path=Path(d)/"backup.zip";Storage().download_to(asset,path)
        manifest=verify_archive(path)
    return {"manifest_hash":digest(manifest),"table_counts":manifest["table_counts"],
            "asset_count":len(manifest["assets"]),"target":"new_inactive_workspace"}

@router.post("/admin/restore")
def restore(body:RestoreBody,user=Depends(admin_user)):
    if not body.expected_manifest_hash:fail("RESTORE_PREFLIGHT_REQUIRED","백업 검사 결과를 먼저 확인해 주세요.")
    with transaction() as conn:
        asset=get(conn,"assets",body.asset_id,user["workspace_id"])
        if asset["kind"]!="research_backup":fail("RESEARCH_BACKUP_REQUIRED","연구 백업 파일이 필요합니다.")
        job=aux(conn,user,"backup",{"action":"restore","asset_id":str(body.asset_id),"manifest_hash":body.expected_manifest_hash})
        return {"job_id":job["id"],"target":"new_inactive_workspace"}

