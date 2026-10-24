from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, Request
from lab.api.auth import current_user
from lab.api.common import get, idempotent
from lab.api.types import ExportBody
from lab.api.papers import aux
from lab.db import transaction, insert, many
from lab.export.analysis import selected_runs,summarize

router=APIRouter()
def filters_for(plan_id="",transport="api",include_fixture=False,include_human_corrected=False,**extra):
    return {"plan_id":plan_id,"transport":transport,"include_fixture":include_fixture,
            "include_human_corrected":include_human_corrected,**{k:v for k,v in extra.items() if v}}

@router.get("/results/summary")
def summary(plan_id:str="",transport:str="api",include_fixture:bool=False,include_human_corrected:bool=False,
            common:bool=True,group_hash:str="",user=Depends(current_user)):
    with transaction() as conn:
        conn.execute("set transaction isolation level repeatable read, read only")
        rows=selected_runs(conn,user,filters_for(plan_id,transport,include_fixture,include_human_corrected))
    return summarize(rows,common,group_hash or None)

@router.get("/results/ideas")
def ideas(plan_id:str="",transport:str="api",include_fixture:bool=False,include_human_corrected:bool=False,
          generator_provider:str="",paper_id:str="",checkpoint_revision_id:str="",repeat_no:int=0,
          cursor:int=0,limit:int=25,user=Depends(current_user)):
    with transaction() as conn:
        conn.execute("set transaction isolation level repeatable read, read only")
        rows=selected_runs(conn,user,filters_for(plan_id,transport,include_fixture,include_human_corrected,
            generator_provider=generator_provider,paper_id=paper_id,checkpoint_revision_id=checkpoint_revision_id,repeat_no=repeat_no))
    cursor=max(0,cursor);limit=min(100,max(1,limit))
    # Keep list DTO compact; full snapshots are available via /runs/:id.
    safe=[{k:r[k] for k in ("id","plan_id","paper_id","paper_code","paper_title","checkpoint_revision_id",
        "checkpoint_code","generator_provider","repeat_no","status","metrics","input_mode","transport","group_hash")} for r in rows]
    return {"items":safe[cursor:cursor+limit],"total":len(safe),"next_cursor":str(cursor+limit) if len(safe)>cursor+limit else None}

@router.post("/exports")
def export(body:ExportBody,request:Request,user=Depends(current_user)):
    with transaction() as conn:
        def create(key):
            # Resolve selected scope before queueing; no AI requests are triggered by exports.
            rows=selected_runs(conn,user,body.filters)
            frozen_filters={**body.filters,"plan_ids":sorted({str(r["plan_id"]) for r in rows})}
            row=insert(conn,"lab.exports",dict(id=uuid4(),workspace_id=user["workspace_id"],
                kind=body.kind,filters=frozen_filters,created_by=user["user_id"]))
            job=aux(conn,user,"export",{"export_id":str(row["id"]),"include_source":body.include_source})
            return {"export_id":row["id"],"job_id":job["id"]}
        return idempotent(conn,request,user,body.model_dump(),create)

@router.get("/exports/{ident}")
def export_detail(ident:UUID,user=Depends(current_user)):
    with transaction() as conn:return get(conn,"exports",ident,user["workspace_id"])

