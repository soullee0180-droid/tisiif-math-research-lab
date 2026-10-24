from uuid import UUID, uuid4
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from lab.api.auth import current_user
from lab.api.common import get, fail, idempotent, with_hash, check_hash
from lab.api.types import ReserveBody, PaperPatch, CheckpointBody, CloneBody, RevisionPatch, ApproveBody
from lab.db import transaction, one, many, insert, update, audit
from lab.domain.research import digest, input_hash, input_snapshot
from lab.storage.client import Storage
from lab.pdf.prepare import validate_recipe, png

from lab.api.dto import PaperListDTO

router=APIRouter()
def aux(conn,user,phase,payload):
    return insert(conn,"lab.jobs",dict(id=uuid4(),workspace_id=user["workspace_id"],phase=phase,
        status="queued",payload={**payload,"actor_id":str(user["user_id"])}))

@router.get("/papers",response_model=PaperListDTO)
def papers(q:str="",status:str="",archived:bool=False,cursor:int=0,limit:int=25,user=Depends(current_user)):
    limit=max(1,min(100,limit));cursor=max(0,cursor)
    with transaction() as conn:
        rows=many(conn,"""select p.*,m.display_name created_by_name,a.status source_status,
            (select count(*) from lab.checkpoints c where c.paper_id=p.id and c.workspace_id=p.workspace_id) checkpoint_count,
            exists(select 1 from lab.checkpoint_revisions r join lab.checkpoints c on c.id=r.checkpoint_id
                where c.paper_id=p.id and c.workspace_id=p.workspace_id and r.status='approved') has_approved
            from lab.papers p left join lab.assets a on a.id=p.source_asset_id and a.workspace_id=p.workspace_id
            left join lab.workspace_members m on m.workspace_id=p.workspace_id and m.user_id=p.created_by
            where p.workspace_id=%s and (%s or not p.archived) and (p.title ilike %s or p.code ilike %s)
            order by p.created_at desc,p.id""",(user["workspace_id"],archived,"%"+q+"%","%"+q+"%"))
    for r in rows:
        r["preparation_status"]="error" if r["source_status"]=="failed" else "ready" if r["has_approved"] else "review" if r["source_status"]=="verified" else "preparing"
    if status:rows=[r for r in rows if r["preparation_status"]==status]
    return {"items":rows[cursor:cursor+limit],"next_cursor":str(cursor+limit) if len(rows)>cursor+limit else None,"total":len(rows)}

@router.post("/uploads/reserve")
def reserve(body:ReserveBody,request:Request,user=Depends(current_user)):
    with transaction() as conn:
        def create(key):
            conn.execute("select pg_advisory_xact_lock(hashtextextended(%s,1))",(str(user["workspace_id"]),))
            n=one(conn,"select count(*) n from lab.papers where workspace_id=%s",(user["workspace_id"],))["n"]
            result=[]
            for i,file in enumerate(body.files,1):
                aid,pid=uuid4(),uuid4()
                path=str(user["workspace_id"])+"/"+str(aid)+"/original.pdf"
                asset=insert(conn,"lab.assets",dict(id=aid,workspace_id=user["workspace_id"],kind="source_pdf",
                    bucket="lab-source",object_path=path,original_name=file.name,mime_type="application/pdf",
                    byte_size=file.byte_size,created_by=user["user_id"]))
                insert(conn,"lab.papers",dict(id=pid,workspace_id=user["workspace_id"],code="P"+str(n+i).zfill(3),
                    title=file.name.removesuffix(".pdf"),source_asset_id=aid,created_by=user["user_id"]))
                item={"client_file_id":str(file.client_file_id),"asset_id":aid,"paper_id":pid,
                      "bucket":"lab-source","object_path":path}
                try:item.update(Storage().signed_upload(asset))
                except Exception:item["error"]={"code":"UPLOAD_TOKEN_FAILED","message":"업로드 연결을 준비하지 못했습니다. 재시도해 주세요."}
                result.append(item)
            return {"items":result}
        return idempotent(conn,request,user,body.model_dump(mode="json"),create)

@router.post("/uploads/{ident}/retry")
def retry_upload(ident:UUID,request:Request,user=Depends(current_user)):
    with transaction() as conn:
        asset=get(conn,"assets",ident,user["workspace_id"])
        def action(key):
            if asset["status"]=="verified":fail("ALREADY_VERIFIED","이미 등록된 파일입니다.",409)
            return {**Storage().signed_upload(asset),"bucket":asset["bucket"],"object_path":asset["object_path"]}
        return idempotent(conn,request,user,{},action)

@router.post("/uploads/{ident}/complete")
def complete_upload(ident:UUID,request:Request,user=Depends(current_user)):
    with transaction() as conn:
        asset=get(conn,"assets",ident,user["workspace_id"],True)
        def action(key):
            if asset["status"]=="verified":return {"asset_id":ident,"status":"verified"}
            if asset["kind"]!="source_pdf":fail("INVALID_SOURCE","원본 PDF가 필요합니다.")
            old=one(conn,"select id from lab.jobs where workspace_id=%s and phase='prepare_pdf' and payload->>'asset_id'=%s and status in ('queued','leased')",
                    (user["workspace_id"],str(ident)))
            if old:return {"job_id":old["id"],"asset_id":ident,"status":"uploaded"}
            conn.execute("update lab.assets set status='uploaded' where id=%s and workspace_id=%s",(ident,user["workspace_id"]))
            job=aux(conn,user,"prepare_pdf",{"action":"verify_source","asset_id":str(ident)})
            return {"job_id":job["id"],"asset_id":ident,"status":"uploaded"}
        return idempotent(conn,request,user,{},action)

@router.get("/papers/{ident}")
def paper(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        row=get(conn,"papers",ident,user["workspace_id"])
        cps=many(conn,"select * from lab.checkpoints where paper_id=%s and workspace_id=%s order by code",
                 (ident,user["workspace_id"]))
        for cp in cps:
            cp["revisions"]=many(conn,"select id,version_no,status,created_at,input_mode from lab.checkpoint_revisions where checkpoint_id=%s and workspace_id=%s order by version_no desc",
                                  (cp["id"],user["workspace_id"]))
        row["source_asset"]=get(conn,"assets",row["source_asset_id"],user["workspace_id"]) if row["source_asset_id"] else None
        result=with_hash({k:v for k,v in row.items() if k!="source_asset"})
        return {**result,"source_asset":row["source_asset"],"checkpoints":cps}

@router.patch("/papers/{ident}")
def patch_paper(ident:UUID,body:PaperPatch,user=Depends(current_user)):
    with transaction() as conn:
        row=get(conn,"papers",ident,user["workspace_id"],True)
        check_hash(row,body.expected_hash)
        data=body.model_dump(exclude={"expected_hash"})
        if data["published_date"]:data["published_date"]=datetime.fromisoformat(data["published_date"]).date()
        data["updated_at"]=datetime.now(timezone.utc)
        row=update(conn,"lab.papers",ident,user["workspace_id"],data)
        audit(conn,user,"paper.update","paper",ident)
        return with_hash(row)

@router.post("/papers/{ident}/archive")
def archive(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        get(conn,"papers",ident,user["workspace_id"])
        conn.execute("update lab.papers set archived=not archived,updated_at=now() where id=%s and workspace_id=%s",(ident,user["workspace_id"]))
        audit(conn,user,"paper.archive","paper",ident)
        return {"id":ident}

@router.post("/papers/{ident}/checkpoints")
def checkpoint(ident:UUID,body:CheckpointBody,user=Depends(current_user)):
    with transaction() as conn:
        paper=get(conn,"papers",ident,user["workspace_id"],True)
        asset=get(conn,"assets",paper["source_asset_id"],user["workspace_id"])
        if asset["status"]!="verified":fail("SOURCE_NOT_VERIFIED","원본 PDF 검증을 기다려 주세요.",409)
        n=one(conn,"select count(*) n from lab.checkpoints where paper_id=%s and workspace_id=%s",(ident,user["workspace_id"]))["n"]+1
        cp=insert(conn,"lab.checkpoints",dict(id=uuid4(),workspace_id=user["workspace_id"],paper_id=ident,
            code="CP"+str(n).zfill(2),title=body.title,created_by=user["user_id"]))
        rev=insert(conn,"lab.checkpoint_revisions",dict(id=uuid4(),workspace_id=user["workspace_id"],
            checkpoint_id=cp["id"],title=body.title,version_no=1,source_asset_id=paper["source_asset_id"],created_by=user["user_id"],
            page_recipe=[{"page":i,"include":True,"rotation":0,"masks":[]} for i in range(1,asset["page_count"]+1)]))
        return {"checkpoint":cp,"revision":with_hash(rev)}

@router.get("/checkpoints/{ident}")
def get_checkpoint(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        row=get(conn,"checkpoints",ident,user["workspace_id"])
        return {**row,"revisions":many(conn,"select id,version_no,status,created_at from lab.checkpoint_revisions where checkpoint_id=%s and workspace_id=%s order by version_no desc",
                                      (ident,user["workspace_id"]))}

@router.post("/checkpoints/{ident}/revisions")
def clone(ident:UUID,body:CloneBody,user=Depends(current_user)):
    with transaction() as conn:
        get(conn,"checkpoints",ident,user["workspace_id"],True)
        src=get(conn,"checkpoint_revisions",body.source_revision_id,user["workspace_id"])
        if str(src["checkpoint_id"])!=str(ident):fail("REVISION_MISMATCH","분기점 버전이 일치하지 않습니다.")
        n=one(conn,"select max(version_no)+1 n from lab.checkpoint_revisions where checkpoint_id=%s and workspace_id=%s",(ident,user["workspace_id"]))["n"]
        data={k:v for k,v in src.items() if k not in ("id","created_at","reviewed_by","reviewed_at","public_input_sha256")}
        data.update(id=uuid4(),version_no=n,status="draft",created_by=user["user_id"])
        return with_hash(insert(conn,"lab.checkpoint_revisions",data))

@router.get("/checkpoint-revisions/{ident}")
def revision(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        row=get(conn,"checkpoint_revisions",ident,user["workspace_id"])
        return with_hash(row)

@router.patch("/checkpoint-revisions/{ident}")
def save_revision(ident:UUID,body:RevisionPatch,user=Depends(current_user)):
    with transaction() as conn:
        row=get(conn,"checkpoint_revisions",ident,user["workspace_id"],True)
        if row["status"]=="approved":fail("APPROVED_REVISION_IMMUTABLE","새 버전을 만들어 수정해 주세요.",409)
        check_hash(row,body.expected_hash)
        indices=[s.get("index") for s in body.stage_outline]
        if any(type(i) is not int or i<1 for i in indices) or len(set(indices))!=len(indices):
            fail("INVALID_STAGE_INDEX","공개 단계 번호를 확인해 주세요.")
        data=body.model_dump(exclude={"expected_hash"})
        changed=row["page_recipe"]!=data["page_recipe"] or row["input_mode"]!=data["input_mode"]
        if data["input_mode"]=="pdf":
            asset=get(conn,"assets",row["source_asset_id"],user["workspace_id"])
            validate_recipe(data["page_recipe"],asset["page_count"])
        data["status"]="draft"
        data["public_input_sha256"]=None
        if changed:data["prepared_asset_id"]=None
        return with_hash(update(conn,"lab.checkpoint_revisions",ident,user["workspace_id"],data))

def preparation_fingerprint(row):
    return digest({k:row[k] for k in ("page_recipe","source_asset_id","input_mode")})

@router.post("/checkpoint-revisions/{ident}/prepare")
def prepare(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        row=get(conn,"checkpoint_revisions",ident,user["workspace_id"],True)
        if row["status"]=="approved":fail("APPROVED_REVISION_IMMUTABLE","승인된 자료는 변경할 수 없습니다.",409)
        if not row["goal_md"].strip() or not row["obstacle_md"].strip():
            fail("PUBLIC_TASK_REQUIRED","연구 목표와 현재 장애를 입력해 주세요.")
        if row["input_mode"]=="text":
            if not row["public_text_md"].strip():fail("PUBLIC_TEXT_REQUIRED","공개 텍스트를 입력해 주세요.")
            update(conn,"lab.checkpoint_revisions",ident,user["workspace_id"],
                   {"status":"review","public_input_sha256":input_hash(row)})
            return {"ready":True}
        source=get(conn,"assets",row["source_asset_id"],user["workspace_id"])
        validate_recipe(row["page_recipe"],source["page_count"])
        job=aux(conn,user,"prepare_pdf",{"action":"sanitize","revision_id":str(ident),
                                      "preparation_fingerprint":preparation_fingerprint(row)})
        conn.execute("update lab.checkpoint_revisions set status='preparing' where id=%s and workspace_id=%s",(ident,user["workspace_id"]))
        return {"job_id":job["id"],"ready":False}

@router.get("/checkpoint-revisions/{ident}/public-packet")
def public_packet(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        row=get(conn,"checkpoint_revisions",ident,user["workspace_id"])
        prepared=get(conn,"assets",row["prepared_asset_id"],user["workspace_id"]) if row["prepared_asset_id"] else None
        return {"packet":input_snapshot(row,prepared),"hash":input_hash(row,prepared),"status":row["status"]}

@router.post("/checkpoint-revisions/{ident}/approve")
def approve(ident:UUID,body:ApproveBody,user=Depends(current_user)):
    with transaction() as conn:
        row=get(conn,"checkpoint_revisions",ident,user["workspace_id"],True)
        if row["status"]!="review":fail("REVIEW_REQUIRED","전송 자료를 준비하고 확인해 주세요.",409)
        prepared=get(conn,"assets",row["prepared_asset_id"],user["workspace_id"]) if row["prepared_asset_id"] else None
        sha=input_hash(row,prepared)
        if row["public_input_sha256"]!=sha or body.reviewed_hash!=sha:
            fail("PREVIEW_STALE","자료가 변경되었습니다. 미리보기를 다시 확인해 주세요.",409)
        if not row["reference_idea_md"].strip() or not row["reference_location"].strip():
            fail("REFERENCE_REQUIRED","기준 아이디어와 원문 위치를 입력해 주세요.")
        update(conn,"lab.checkpoint_revisions",ident,user["workspace_id"],
               {"status":"approved","reviewed_by":user["user_id"],"reviewed_at":datetime.now(timezone.utc)})
        if row.get("title"):conn.execute("update lab.checkpoints set title=%s where workspace_id=%s and id=%s",(row["title"],user["workspace_id"],row["checkpoint_id"]))
        audit(conn,user,"revision.approve","checkpoint_revision",ident,{"public_hash":sha})
        return {"revision_id":ident,"status":"approved","hash":sha}

@router.get("/assets/{ident}/download")
def download(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:
        asset=get(conn,"assets",ident,user["workspace_id"])
    if asset["status"]!="verified":fail("ASSET_NOT_READY","파일 준비를 기다려 주세요.",409)
    return Storage().signed_download(asset)

@router.get("/assets/{ident}/pages/{page}")
def page_preview(ident:UUID,page:int,rotation:int=0,user=Depends(current_user)):
    if rotation not in (0,90,180,270):fail("INVALID_ROTATION","회전 값을 확인해 주세요.")
    with transaction() as conn:
        asset=get(conn,"assets",ident,user["workspace_id"])
    if asset["status"]!="verified" or asset["kind"] not in ("source_pdf","prepared_pdf"):
        fail("PDF_NOT_READY","PDF 준비를 기다려 주세요.",409)
    data=png(Storage().get(asset),page,rotation)
    return Response(data,media_type="image/png",headers={"Cache-Control":"private, no-store"})

