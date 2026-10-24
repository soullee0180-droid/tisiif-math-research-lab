from uuid import UUID, uuid4
from collections import defaultdict
from fastapi import APIRouter, Depends, Request
from lab.api.auth import current_user
from lab.api.common import get, fail
from lab.api.types import ReviewBatchBody, ReviewSubmit
from lab.db import transaction, one, many, insert, audit
from lab.domain.research import digest, public_context
from lab.export.analysis import selected_runs

router=APIRouter()

@router.post("/review-batches")
def batch(body:ReviewBatchBody,user=Depends(current_user)):
    with transaction() as conn:
        rows=[]
        # Keep transport/cohort boundaries explicit even for a manually selected audit sample.
        for plan_id in body.plan_ids:
            p=get(conn,"plans",plan_id,user["workspace_id"])
            rows+=selected_runs(conn,user,{"plan_ids":[str(plan_id)],"transport":p["transport"],"include_fixture":True,"include_human_corrected":True})
        members={m["user_id"] for m in many(conn,"select user_id from lab.workspace_members where workspace_id=%s and active",(user["workspace_id"],))}
        if any(i not in members for i in body.reviewer_ids):fail("REVIEWER_NOT_MEMBER","활성 팀원만 검토자로 지정할 수 있습니다.")
        strata=defaultdict(list)
        seen=set()
        for r in rows:
            if not r["selection"]:continue
            for idea in r["ideas"]:
                if idea["id"] in seen:continue
                seen.add(idea["id"])
                strata[r["generator_provider"]+(" / selected" if idea["selected"] else " / nonselected")].append(idea)
        definition={}
        for provider in ("google","openai","anthropic"):
            for selected in ("selected","nonselected"):
                key=provider+" / "+selected
                population=strata[key]
                chosen=sorted(population,key=lambda x:__import__("hashlib").sha256((body.seed+":"+str(x["id"])).encode()).hexdigest())[:body.per_stratum]
                definition[key]={"population":len(population),"selected":[str(x["id"]) for x in chosen],
                    "actual":len(chosen),"shortage":max(0,body.per_stratum-len(chosen))}
        batch=insert(conn,"lab.review_batches",dict(id=uuid4(),workspace_id=user["workspace_id"],plan_ids=body.plan_ids,
            seed=body.seed,sampling_definition=definition,created_by=user["user_id"]))
        count=0
        for stratum,s in definition.items():
            for ident in s["selected"]:
                count+=1
                for reviewer in set(body.reviewer_ids):
                    insert(conn,"lab.review_assignments",dict(id=uuid4(),workspace_id=user["workspace_id"],
                        review_batch_id=batch["id"],idea_id=ident,reviewer_id=reviewer,stratum=stratum,
                        inclusion_probability=s["actual"]/s["population"],display_code="Review-"+str(count).zfill(3)))
        audit(conn,user,"review_batch.create","review_batch",batch["id"])
        return {"id":batch["id"],"sampling_definition":definition,"assigned_judgments":count*len(set(body.reviewer_ids))}

@router.get("/review-assignments")
def assignments(batch_id:str="",user=Depends(current_user)):
    with transaction() as conn:
        rows=many(conn,"""select a.id,a.review_batch_id,a.display_code,a.phase,a.created_at,
            (select coalesce(max(revision_no),0) from lab.human_reviews h where h.assignment_id=a.id) revision_count
            from lab.review_assignments a where workspace_id=%s and reviewer_id=%s order by created_at,display_code""",
            (user["workspace_id"],user["user_id"]))
        if batch_id:rows=[r for r in rows if str(r["review_batch_id"])==batch_id]
        batches=many(conn,"select id,seed,created_at from lab.review_batches where workspace_id=%s order by created_at desc",(user["workspace_id"],))
        return {"items":rows,"total":len(rows),"next_cursor":None,"batches":batches}

@router.get("/review-assignments/{ident}")
def assignment(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        a=get(conn,"review_assignments",ident,user["workspace_id"])
        if a["reviewer_id"]!=user["user_id"]:fail("FORBIDDEN","본인에게 배정된 항목만 검토할 수 있습니다.",403)
        idea=one(conn,"select * from lab.ideas where workspace_id=%s and id=%s",(user["workspace_id"],a["idea_id"]))
        run=get(conn,"runs",idea["run_id"],user["workspace_id"])
        plan=get(conn,"plans",run["plan_id"],user["workspace_id"])
        snap=plan["frozen_config"]["inputs"][str(run["checkpoint_revision_id"])]
        own=many(conn,"select * from lab.human_reviews where workspace_id=%s and assignment_id=%s order by phase,revision_no",(user["workspace_id"],ident))
    # Do NOT return the assignment row, run UUID, generator, original idea ID, selection or AI ratings.
    dto={"id":a["id"],"display_code":a["display_code"],"phase":a["phase"],
         "public_input":snap,"idea":{k:idea[k] for k in ("title","idea_md","why_helpful_md","next_steps","assumptions","unverified_points")},
         "own_reviews":[{k:r[k] for k in ("phase","revision_no","score","validity","agreement_label","rationale_md","unable_reason","correction_reason")} for r in own]}
    if a["phase"]!="usefulness":
        dto["reference_idea_md"]=plan["frozen_config"]["references"][str(run["checkpoint_revision_id"])]
    return dto

@router.post("/review-assignments/{ident}/submit")
def submit(ident:UUID,body:ReviewSubmit,user=Depends(current_user)):
    with transaction() as conn:
        a=get(conn,"review_assignments",ident,user["workspace_id"],True)
        if a["reviewer_id"]!=user["user_id"]:fail("FORBIDDEN","본인에게 배정된 항목만 검토할 수 있습니다.",403)
        if body.phase=="agreement" and a["phase"]=="usefulness":fail("USEFULNESS_FIRST","유용성을 먼저 제출해 주세요.",409)
        previous=one(conn,"select coalesce(max(revision_no),0) n from lab.human_reviews where workspace_id=%s and assignment_id=%s and phase=%s",(user["workspace_id"],ident,body.phase))["n"]
        if previous!=body.expected_revision_no:fail("REVIEW_CONFLICT","최신 검토 내용을 다시 불러와 주세요.",409)
        if previous and not (body.correction_reason or "").strip():fail("CORRECTION_REASON_REQUIRED","수정 이유를 입력해 주세요.")
        if body.phase=="usefulness":
            if not body.validity or body.agreement_label is not None:
                fail("INVALID_USEFULNESS","유용성 판단을 확인해 주세요.")
            if body.score is None and not (body.unable_reason or "").strip():
                fail("UNABLE_REASON_REQUIRED","판단할 수 없는 이유를 입력해 주세요.")
        else:
            if not body.agreement_label or body.score is not None or body.validity is not None:
                fail("INVALID_AGREEMENT","일치도 판단을 확인해 주세요.")
            if body.agreement_label=="undetermined" and not (body.unable_reason or "").strip():
                fail("UNABLE_REASON_REQUIRED","판단할 수 없는 이유를 입력해 주세요.")
        row=insert(conn,"lab.human_reviews",dict(id=uuid4(),workspace_id=user["workspace_id"],assignment_id=ident,
            revision_no=previous+1,created_by=user["user_id"],
            **body.model_dump(exclude={"expected_revision_no"})))
        if not previous:
            conn.execute("update lab.review_assignments set phase=%s where workspace_id=%s and id=%s",
                         ("agreement" if body.phase=="usefulness" else "done",user["workspace_id"],ident))
        audit(conn,user,"human_review.submit","review_assignment",ident,{"phase":body.phase,"revision":previous+1})
        return {"id":row["id"],"revision_no":previous+1}

