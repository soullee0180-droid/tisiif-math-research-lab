from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from uuid import uuid4
from lab.db import one, many, insert
from lab.domain.research import PROVIDERS, digest, input_snapshot
from lab.api.common import fail, get
from lab.providers.adapters import validate_profile

def build_frozen(conn, user, body):
    ws = user["workspace_id"]
    protocol = get(conn, "protocol_versions", body.protocol_id, ws)
    pdef = protocol["definition"]
    k, repeats = pdef["candidate_count"], pdef["independent_repeats"]
    if not 1 <= k <= 10 or not 1 <= repeats <= 10:
        fail("INVALID_PROTOCOL", "프로토콜의 후보 수와 반복 수를 확인해 주세요.")
    if len(set(body.checkpoint_revision_ids)) != len(body.checkpoint_revision_ids):
        fail("DUPLICATE_REVISION", "같은 분기점 버전을 중복 선택할 수 없습니다.")
    if body.transport == "mock" and body.cohort != "fixture":
        fail("FIXTURE_COHORT_REQUIRED", "가상 검수는 연구 자료와 구분해야 합니다.")
    if body.transport == "api" and body.cohort in ("fixture","manual"):
        fail("TRANSPORT_COHORT_MISMATCH", "실행 경로와 실험 구분을 확인해 주세요.")
    if body.transport == "manual" and body.cohort != "manual":
        fail("MANUAL_COHORT_REQUIRED", "수동 실험은 별도 구분으로 등록해 주세요.")
    models = {}
    if body.transport == "mock":
        for provider in PROVIDERS:
            models[provider] = {"provider": provider, "model_id": "fixture-" + provider,
                "label": "가상 검수", "config": {}, "capabilities": {}, "verification_status": "fixture"}
    else:
        if set(body.generator_profile_ids) != set(PROVIDERS):
            fail("THREE_PROVIDERS_REQUIRED", "세 제공사의 모델을 모두 선택해 주세요.")
        for provider in PROVIDERS:
            row = get(conn, "model_profiles", body.generator_profile_ids[provider], ws)
            if row["provider"] != provider:
                fail("PROFILE_PROVIDER_MISMATCH", "모델 제공사가 일치하지 않습니다.")
            validate_profile(row)
            if body.transport == "api":
                if row["verification_status"] != "passed":
                    fail("PROFILE_UNVERIFIED", "실제 연결이 확인된 모델 프로필이 필요합니다.")
                runtime = one(conn, "select * from lab_private.provider_runtime where provider=%s", (provider,))
                if not runtime or not runtime["enabled"] or runtime["blocked_reason"]:
                    fail("PROVIDER_NOT_READY", "제공사 연결 상태를 확인해 주세요.", details={"provider":provider})
                if not runtime["metadata"].get("eligibility_confirmed"):
                    fail("ELIGIBILITY_UNCONFIRMED", "제공사 이용 조건 확인이 필요합니다.", details={"provider":provider})
                if not one(conn, "select 1 from lab_private.provider_secrets where workspace_id=%s and provider=%s",
                           (ws,provider)):
                    fail("KEY_REQUIRED", "제공사 API 키를 설정해 주세요.")
            models[provider] = {key: row[key] for key in
                ("id","provider","label","model_id","config","capabilities","verification_status","verified_at")}
    inputs, references, paper_ids, revision_ids = {}, {}, {}, []
    for ident in body.checkpoint_revision_ids:
        rev = get(conn, "checkpoint_revisions", ident, ws)
        if rev["status"] != "approved":
            fail("INPUT_APPROVAL_REQUIRED", "승인된 분기점 버전만 실행할 수 있습니다.")
        asset = get(conn, "assets", rev["prepared_asset_id"], ws) if rev["input_mode"] == "pdf" else None
        if asset and asset["status"] != "verified": fail("PDF_NOT_READY", "전송 PDF 검증을 기다려 주세요.")
        if body.transport == "api" and asset:
            for profile in models.values():
                cap = profile["capabilities"]
                if not cap.get("pdf_supported") or not cap.get("structured_output_supported"):
                    fail("CAPABILITY_REQUIRED", "PDF와 구조화 응답 지원을 확인해 주세요.")
                if asset["byte_size"] > cap.get("max_pdf_bytes", 0) or asset["page_count"] > cap.get("max_pdf_pages",0):
                    fail("PDF_EXCEEDS_PROFILE_LIMIT", "전송 PDF가 모델 한도를 넘습니다.")
        cp = get(conn, "checkpoints", rev["checkpoint_id"], ws)
        snap = input_snapshot(rev, asset)
        snap["hash"] = rev["public_input_sha256"]
        inputs[str(ident)] = snap
        references[str(ident)] = rev["reference_idea_md"]
        paper_ids[str(ident)] = str(cp["paper_id"])
        revision_ids.append(str(ident))
    frozen = {"protocol": pdef, "protocol_id": str(protocol["id"]),
        "inputs": inputs, "references": references, "models": models, "paper_ids": paper_ids,
        "revision_ids": revision_ids, "cohort": body.cohort, "transport": body.transport}
    return frozen

def preflight(conn, user, body):
    frozen = build_frozen(conn, user, body)
    n = len(frozen["inputs"]) * 3 * frozen["protocol"]["independent_repeats"]
    return {"preflight_hash": digest(frozen), "run_count": n,
        "logical_job_count": n * 6, "candidate_count": n * frozen["protocol"]["candidate_count"],
        "frozen": frozen}

def create_plan(conn, user, body, key):
    checked = preflight(conn,user,body)
    if body.preflight_hash and body.preflight_hash != checked["preflight_hash"]:
        fail("PREFLIGHT_CHANGED", "설정이 변경되었습니다. 실행 조건을 다시 확인해 주세요.",409)
    now = datetime.now(timezone.utc)
    scheduled = None
    if body.schedule.mode == "scheduled":
        try:
            dt = datetime.fromisoformat(body.schedule.local_datetime)
            if dt.tzinfo: fail("LOCAL_TIME_REQUIRED", "한국시간으로 예약 시각을 입력해 주세요.")
            scheduled = dt.replace(tzinfo=ZoneInfo("Asia/Seoul")).astimezone(timezone.utc)
        except (ValueError, TypeError):
            fail("INVALID_SCHEDULE", "예약 시각을 확인해 주세요.")
    status = "scheduled" if scheduled and scheduled > now else "running"
    plan = insert(conn,"lab.plans",dict(id=uuid4(),workspace_id=user["workspace_id"], title=body.title,
        cohort=body.cohort,transport=body.transport,status=status,protocol_id=body.protocol_id,
        frozen_config=checked["frozen"],frozen_sha256=checked["preflight_hash"],scheduled_at=scheduled,
        created_by=user["user_id"],idempotency_key=key,started_at=now if status=="running" else None))
    frozen = checked["frozen"]
    for revision in frozen["revision_ids"]:
        for provider in PROVIDERS:
            for repeat in range(1, frozen["protocol"]["independent_repeats"]+1):
                rid=uuid4()
                run = insert(conn,"lab.runs",dict(id=rid,workspace_id=user["workspace_id"],plan_id=plan["id"],
                    paper_id=frozen["paper_ids"][revision],checkpoint_revision_id=revision,
                    generator_provider=provider,generator_model=frozen["models"][provider],
                    judge_models={p:frozen["models"][p] for p in PROVIDERS if p!=provider},
                    repeat_no=repeat,candidate_count=frozen["protocol"]["candidate_count"],
                    transport=body.transport,status="needs_input" if body.transport=="manual" else "queued",
                    request_fingerprint=digest([frozen["inputs"][revision],provider,repeat,frozen["models"][provider]]),
                    display_seed=str(rid)))
                gen_id=uuid4()
                base=dict(workspace_id=user["workspace_id"],run_id=run["id"],plan_id=plan["id"])
                insert(conn,"lab.jobs",{**base,"id":gen_id,"phase":"generate",
                    "provider":"mock" if body.transport=="mock" else provider,
                    "status":"needs_input" if body.transport=="manual" else "queued"})
                insert(conn,"lab.jobs",{**base,"id":uuid4(),"phase":"select",
                    "provider":"mock" if body.transport=="mock" else provider,
                    "status":"blocked","depends_on":[gen_id]})
                for judge in PROVIDERS:
                    if judge == provider: continue
                    for phase in ("usefulness","agreement"):
                        insert(conn,"lab.jobs",{**base,"id":uuid4(),"phase":phase,"judge_provider":judge,
                            "provider":"mock" if body.transport=="mock" else judge,
                            "status":"blocked","depends_on":[gen_id]})
    return {"plan_id":plan["id"],"run_count":checked["run_count"],
        "logical_job_count":checked["logical_job_count"],"state":status,"frozen_sha256":plan["frozen_sha256"]}

def refresh_progress(conn, workspace, plan_id, run_id=None):
    # Serialize completion accounting so simultaneous last stages cannot leave a plan running.
    one(conn,"select id from lab.plans where workspace_id=%s and id=%s for update",(workspace,plan_id))
    conn.execute("""update lab.runs r set status=case
        when not exists(select 1 from lab.jobs j where j.run_id=r.id and j.status<>'completed') then 'completed'
        when exists(select 1 from lab.jobs j where j.run_id=r.id and j.status='completed') then 'partial'
        when exists(select 1 from lab.jobs j where j.run_id=r.id and j.status in ('failed','unknown_remote','needs_review')) then 'needs_review'
        when r.transport='manual' then 'needs_input' else 'running' end
        where workspace_id=%s and plan_id=%s and (%s::uuid is null or r.id=%s::uuid)""",(workspace,plan_id,run_id,run_id))
    counts=one(conn,"""select count(*) total,count(*) filter(where status='completed') completed,
        count(*) filter(where status in ('failed','unknown_remote','needs_review')) problem
        from lab.jobs where workspace_id=%s and plan_id=%s""",(workspace,plan_id))
    if counts["total"] and counts["total"]==counts["completed"]:
        conn.execute("update lab.plans set status='completed',finished_at=now() where id=%s and workspace_id=%s",
                     (plan_id,workspace))
    elif counts["problem"]:
        conn.execute("update lab.plans set status='partial' where id=%s and workspace_id=%s and status='running'",
                     (plan_id,workspace))
    return counts

