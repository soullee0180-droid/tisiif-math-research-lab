import json
from uuid import UUID, uuid4
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request
from lab.api.auth import current_user
from lab.api.common import get, fail, control, idempotent, require_admin
from lab.api.types import PlanBody, RetryBody, ManualBody
from lab.db import transaction, one, many, insert, audit, value
from lab.domain.plans import preflight, create_plan, refresh_progress
from lab.domain.research import canonical, parse_output, PROVIDERS
from lab.storage.client import Storage

router=APIRouter()
@router.get('/experiment-inputs')
def experiment_inputs(user=Depends(current_user)):
    with transaction() as conn:
        rows=many(conn,"""select v.id,v.version_no,v.input_mode,c.id checkpoint_id,c.code checkpoint_code,
            c.title checkpoint_title,p.id paper_id,p.code paper_code,p.title paper_title
            from lab.checkpoint_revisions v join lab.checkpoints c on c.id=v.checkpoint_id and c.workspace_id=v.workspace_id
            join lab.papers p on p.id=c.paper_id and p.workspace_id=v.workspace_id
            where v.workspace_id=%s and v.status='approved' and not p.archived and not c.archived
            order by p.code,c.code,v.version_no desc""",(user['workspace_id'],))
        return {'items':rows}

@router.get("/model-profiles")
def profiles(user=Depends(current_user)):
    with transaction() as conn:
        return {"items":many(conn,"select * from lab.model_profiles where workspace_id=%s order by created_at desc",(user["workspace_id"],))}

@router.post("/plans/preflight")
def preview(body:PlanBody,user=Depends(current_user)):
    with transaction() as conn:
        result=preflight(conn,user,body)
        result.pop("frozen")
        return result

@router.post("/plans")
def create(body:PlanBody,request:Request,user=Depends(current_user)):
    with transaction() as conn:
        def action(key):
            result=create_plan(conn,user,body,key)
            audit(conn,user,"plan.create","plan",result["plan_id"],{"transport":body.transport,"cohort":body.cohort})
            return result
        return idempotent(conn,request,user,body.model_dump(mode="json"),action)

@router.get("/plans")
def list_plans(q:str="",status:str="",created_by:str="",cohort:str="",include_fixture:bool=False,
               cursor:int=0,limit:int=25,user=Depends(current_user)):
    cursor=max(cursor,0);limit=min(max(1,limit),100)
    with transaction() as conn:
        rows=many(conn,"""select p.id,p.title,p.cohort,p.transport,p.status,p.created_by,p.created_at,
            p.scheduled_at,p.started_at,p.finished_at,p.protocol_id,m.display_name created_by_name,
            (select count(*) from lab.runs r where r.plan_id=p.id) run_count,
            (select count(*) from lab.jobs j where j.plan_id=p.id) job_count,
            (select count(*) from lab.jobs j where j.plan_id=p.id and j.status='completed') completed_jobs
            from lab.plans p left join lab.workspace_members m on m.workspace_id=p.workspace_id and m.user_id=p.created_by
            where p.workspace_id=%s and p.title ilike %s
            order by p.created_at desc,p.id""",(user["workspace_id"],"%"+q+"%"))
    if not include_fixture:rows=[r for r in rows if r["cohort"] not in ("fixture","diagnostic")]
    if status:rows=[r for r in rows if r["status"]==status]
    if created_by:rows=[r for r in rows if str(r["created_by"])==created_by]
    if cohort:rows=[r for r in rows if r["cohort"]==cohort]
    return {"items":rows[cursor:cursor+limit],"total":len(rows),"next_cursor":str(cursor+limit) if len(rows)>cursor+limit else None}

@router.get("/plans/{ident}")
def detail(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        plan=get(conn,"plans",ident,user["workspace_id"])
        counts=one(conn,"""select count(*) total,count(*) filter(where status='completed') completed,
            count(*) filter(where status in ('unknown_remote','needs_review','failed','blocked') and error_class is not null) review
            from lab.jobs where workspace_id=%s and plan_id=%s""",(user["workspace_id"],ident))
        return {**plan,"progress":counts}

@router.get("/plans/{ident}/runs")
def plan_runs(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        get(conn,"plans",ident,user["workspace_id"])
        rows=many(conn,"""select r.*,p.code paper_code,p.title paper_title,c.code checkpoint_code,v.version_no
            from lab.runs r join lab.papers p on p.id=r.paper_id and p.workspace_id=r.workspace_id
            join lab.checkpoint_revisions v on v.id=r.checkpoint_revision_id and v.workspace_id=r.workspace_id
            join lab.checkpoints c on c.id=v.checkpoint_id and c.workspace_id=r.workspace_id
            where r.workspace_id=%s and r.plan_id=%s order by p.code,c.code,r.generator_provider,r.repeat_no""",(user["workspace_id"],ident))
        jobs=many(conn,"select * from lab.jobs where workspace_id=%s and plan_id=%s order by created_at",(user["workspace_id"],ident))
        for r in rows:r["jobs"]=[j for j in jobs if j["run_id"]==r["id"]]
        return {"items":rows,"total":len(rows),"next_cursor":None}

def plan_action(ident,user,action):
    with transaction() as conn:
        plan=get(conn,"plans",ident,user["workspace_id"],True);control(user,plan)
        if plan["status"] in ("completed","cancelled"):fail("PLAN_FINISHED","종료된 실험은 변경할 수 없습니다.",409)
        if action=="pause":state="paused"
        elif action=="resume":state="running"
        else:state="cancelled"
        conn.execute("update lab.plans set status=%s where id=%s and workspace_id=%s",(state,ident,user["workspace_id"]))
        if action=="cancel":
            conn.execute("""update lab.jobs set status='cancelled',updated_at=now() where plan_id=%s and workspace_id=%s
                and status in ('queued','blocked','waiting_rate','needs_input','leased') and
                not exists(select 1 from lab.attempts a where a.job_id=lab.jobs.id and a.status='dispatching')""",(ident,user["workspace_id"]))
        audit(conn,user,"plan."+action,"plan",ident)
        return {"id":ident,"status":state}

@router.post("/plans/{ident}/pause")
def pause(ident:UUID,user=Depends(current_user)):return plan_action(ident,user,"pause")
@router.post("/plans/{ident}/resume")
def resume(ident:UUID,user=Depends(current_user)):return plan_action(ident,user,"resume")
@router.post("/plans/{ident}/cancel")
def cancel(ident:UUID,user=Depends(current_user)):return plan_action(ident,user,"cancel")

@router.get("/runs/{ident}")
def run_detail(ident:UUID,user=Depends(current_user)):
    from lab.export.analysis import selected_runs
    with transaction() as conn:
        run=get(conn,"runs",ident,user["workspace_id"])
        rows=selected_runs(conn,user,{"plan_ids":[str(run["plan_id"])],"transport":run["transport"],
                                     "include_fixture":True,"include_human_corrected":True})
        return next((r for r in rows if r["id"]==ident),run)

@router.get("/jobs")
def list_jobs(status:str="",provider:str="",plan_id:str="",created_by:str="",cursor:int=0,limit:int=50,user=Depends(current_user)):
    cursor=max(cursor,0);limit=min(max(1,limit),100)
    with transaction() as conn:
        rows=many(conn,"""select j.*,p.title plan_title,p.created_by,p.transport,
            t.code paper_code,c.code checkpoint_code,
            (select count(*) from lab.attempts a where a.job_id=j.id) attempt_count
            from lab.jobs j left join lab.plans p on p.id=j.plan_id and p.workspace_id=j.workspace_id
            left join lab.runs r on r.id=j.run_id and r.workspace_id=j.workspace_id
            left join lab.papers t on t.id=r.paper_id and t.workspace_id=j.workspace_id
            left join lab.checkpoint_revisions v on v.id=r.checkpoint_revision_id and v.workspace_id=j.workspace_id
            left join lab.checkpoints c on c.id=v.checkpoint_id and c.workspace_id=j.workspace_id
            where j.workspace_id=%s order by j.updated_at desc,j.id""",(user["workspace_id"],))
        runtime=many(conn,"select provider,enabled,blocked_reason,paused_until,next_dispatch_at,max_concurrency,rpm_limit,tpm_limit,metadata from lab_private.provider_runtime where provider<>'mock'")
        beats=many(conn,"select worker_name,build_sha,heartbeat_at,active_jobs from lab.worker_heartbeats where workspace_id=%s",(user["workspace_id"],))
    if status=="review":rows=[r for r in rows if r["status"] in ("needs_review","unknown_remote","failed")]
    elif status:rows=[r for r in rows if r["status"]==status]
    if provider:rows=[r for r in rows if r["provider"]==provider]
    if plan_id:rows=[r for r in rows if str(r["plan_id"])==plan_id]
    if created_by:rows=[r for r in rows if str(r["created_by"])==created_by]
    return {"items":rows[cursor:cursor+limit],"total":len(rows),"next_cursor":str(cursor+limit) if len(rows)>cursor+limit else None,"providers":runtime,"heartbeats":beats}

@router.get("/jobs/{ident}")
def job_detail(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        job=get(conn,"jobs",ident,user["workspace_id"])
        attempts=many(conn,"""select id,attempt_no,status,transport,requested_model,returned_model,provider_request_id,
            request_asset_id,response_asset_id,raw_text_asset_id,usage,normalized_settings,http_status,error_class,
            sent_at,received_at,created_at from lab.attempts where job_id=%s and workspace_id=%s order by attempt_no""",(ident,user["workspace_id"]))
        assets={}
        for attempt in attempts:
            for field in ("request_asset_id","response_asset_id","raw_text_asset_id"):
                if attempt[field]:assets[str(attempt[field])]=get(conn,"assets",attempt[field],user["workspace_id"])
    contents={}
    for aid,asset in assets.items():
        if asset["status"]!="verified":continue
        # UI uses a text preview; the full immutable raw remains available for download.
        if (asset["byte_size"] or 0)<2*1024*1024:
            try:contents[aid]=Storage().get(asset).decode()
            except Exception:pass
    return {**job,"attempts":attempts,"contents":contents}

@router.post("/jobs/{ident}/retry")
def retry(ident:UUID,body:RetryBody,request:Request,user=Depends(current_user)):
    with transaction() as conn:
        job=get(conn,"jobs",ident,user["workspace_id"],True)
        if not job["plan_id"]:require_admin(user)
        else:control(user,get(conn,"plans",job["plan_id"],user["workspace_id"]))
        if job["status"] not in ("failed","needs_review","unknown_remote","blocked"):
            fail("JOB_NOT_RETRYABLE","현재 상태에서는 재시도할 수 없습니다.",409)
        if job["accepted_attempt_id"]:fail("ACCEPTED_RESULT_IMMUTABLE","새 실험으로 실행해 주세요.",409)
        if job["status"]=="unknown_remote" and not body.acknowledge_duplicate_risk:
            fail("DUPLICATE_RISK_CONFIRMATION_REQUIRED","중복 실행 가능성을 확인해 주세요.",409)
        def action(key):
            run=get(conn,"runs",job["run_id"],user["workspace_id"]) if job["run_id"] else None
            state="needs_input" if run and run["transport"]=="manual" else "queued"
            conn.execute("update lab.jobs set status=%s,error_class=null,error_message=null,available_at=now(),lease_owner=null,lease_expires_at=null where workspace_id=%s and id=%s",
                         (state,user["workspace_id"],ident))
            audit(conn,user,"job.retry","job",ident,body.model_dump())
            return {"id":ident,"status":"queued"}
        return idempotent(conn,request,user,body.model_dump(),action)

@router.post("/jobs/{ident}/check-remote")
def check_remote(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        job=get(conn,"jobs",ident,user["workspace_id"])
        control(user,get(conn,"plans",job["plan_id"],user["workspace_id"]))
    return {"supported":False,"status":job["status"],"message":"동기 요청의 원격 결과 조회는 지원되지 않습니다. 중복 가능성을 확인한 뒤 새 시도를 등록해 주세요."}

@router.get("/jobs/{ident}/manual-prompt")
def manual_prompt(ident:UUID,user=Depends(current_user)):
    from lab.worker.engine import load_packet
    with transaction() as conn:
        job=get(conn,"jobs",ident,user["workspace_id"])
        plan=get(conn,"plans",job["plan_id"],user["workspace_id"])
        if plan["transport"]!="manual":fail("MANUAL_ONLY","수동 실험 단계에서만 사용할 수 있습니다.")
        if job["status"] not in ("needs_input","needs_review"):fail("DEPENDENCIES_NOT_READY","이전 단계의 응답 등록을 기다려 주세요.",409)
    packet,run,plan=load_packet(job)
    prompt=packet["system_text"]+"\n\n"+packet["user_text"]+"\n\nReturn this JSON schema:\n"+canonical(packet["response_schema"])
    urls={"google":"https://gemini.google.com/","openai":"https://chatgpt.com/","anthropic":"https://claude.ai/"}
    return {"prompt":prompt,"packet":packet,"prepared_asset_id":packet["prepared_pdf_asset_id"],
            "service_url":urls[job["judge_provider"] or run["generator_provider"]]}

@router.post("/jobs/{ident}/manual-response")
def manual_response(ident:UUID,body:ManualBody,request:Request,user=Depends(current_user)):
    from lab.worker.engine import load_packet, accept, reserve_response
    from lab.providers.adapters import ProviderResponse
    with transaction() as conn:
        job=get(conn,"jobs",ident,user["workspace_id"],True)
        plan=get(conn,"plans",job["plan_id"],user["workspace_id"]);control(user,plan)
        if plan["transport"]!="manual" or job["status"] not in ("needs_input","needs_review"):
            fail("MANUAL_NOT_READY","수동 응답을 등록할 수 없는 단계입니다.",409)
    packet,run,plan=load_packet(job)
    if body.mapped_response is not None and not (body.correction_reason or "").strip():
        fail("CORRECTION_REASON_REQUIRED","수동 대응 이유를 입력해 주세요.")
    from uuid import uuid5, NAMESPACE_URL
    from lab.domain.research import digest
    # Store immutable files before the short database mutation. The request idempotency key
    # makes storage retries deterministic, and accepted results remain append-only.
    request_key=request.headers.get("Idempotency-Key","")
    if not request_key:fail("IDEMPOTENCY_KEY_REQUIRED","요청 식별자가 필요합니다.")
    namespace=uuid5(NAMESPACE_URL,str(user["workspace_id"])+":"+str(ident)+":"+request_key+":"+digest(body.model_dump()))
    store=Storage()
    text=canonical(body.mapped_response) if body.mapped_response is not None else body.raw_text
    request_asset=store.persist(user,"request_json",canonical(packet).encode(),"request.json","application/json",ident=uuid5(namespace,"request"))
    raw=store.persist(user,"raw_text",body.raw_text.encode(),"manual.txt","text/plain",ident=uuid5(namespace,"raw"))
    response=store.persist(user,"response_json",canonical({"text":text,"raw":{"manual":True},"model":body.screen_model,"request_id":None,"usage":None,"finish":"stop"}).encode(),"response.json","application/json",ident=uuid5(namespace,"response"))
    with transaction() as conn:
        def action(key):
            job2=get(conn,"jobs",ident,user["workspace_id"],True)
            if job2["accepted_attempt_id"]:fail("ALREADY_ACCEPTED","이미 등록한 응답입니다.",409)
            n=one(conn,"select coalesce(max(attempt_no),0)+1 n from lab.attempts where workspace_id=%s and job_id=%s",(user["workspace_id"],ident))["n"]
            attempt=insert(conn,"lab.attempts",dict(id=uuid4(),workspace_id=user["workspace_id"],job_id=ident,
                attempt_no=n,status="response_saved",transport="manual",requested_model=body.screen_model,
                returned_model=body.screen_model,request_asset_id=request_asset["id"],raw_text_asset_id=raw["id"],
                request_sha256=__import__("lab.domain.research",fromlist=["digest"]).digest(packet),
                normalized_settings={"manual_conditions":body.model_dump(exclude={"raw_text","mapped_response"}),
                    "display_to_canonical":packet["display_to_canonical"],"human_corrected":body.mapped_response is not None},
                received_at=datetime.now(timezone.utc)))
            conn.execute("update lab.attempts set response_asset_id=%s where workspace_id=%s and id=%s",
                         (response["id"],user["workspace_id"],attempt["id"]))
            return {"job_id":ident,"attempt_id":attempt["id"],"text":text}
        saved=idempotent(conn,request,user,body.model_dump(mode="json"),action)
    # A repeated submission reparses the same durable response and never creates another logical result.
    with transaction() as conn:attempt=one(conn,"select * from lab.attempts where id=%s and workspace_id=%s",(saved["attempt_id"],user["workspace_id"]))
    success=accept(job,attempt,packet,ProviderResponse(saved["text"],{"manual":True},body.screen_model),
                   body.mapped_response is not None)
    return {"job_id":ident,"attempt_id":saved["attempt_id"],"accepted":success}

