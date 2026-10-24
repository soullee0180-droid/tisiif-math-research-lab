from collections import defaultdict
from lab.db import one, many
from lab.domain.research import metrics, aggregate, digest, PROVIDERS

def selected_runs(conn, user, filters):
    ws=user["workspace_id"]
    ids=filters.get("plan_ids") or ([filters["plan_id"]] if filters.get("plan_id") else [])
    if not ids:
        row=one(conn,"""select id from lab.plans where workspace_id=%s and cohort in ('main','pilot')
            and transport='api' order by (cohort='main') desc,created_at desc limit 1""",(ws,))
        ids=[row["id"]] if row else []
    if not ids:return []
    rows=many(conn,"""select r.*,p.cohort,p.frozen_config,p.frozen_sha256,p.title plan_title,
        v.input_mode,c.code checkpoint_code,t.code paper_code,t.title paper_title
        from lab.runs r join lab.plans p on p.id=r.plan_id and p.workspace_id=r.workspace_id
        join lab.checkpoint_revisions v on v.id=r.checkpoint_revision_id and v.workspace_id=r.workspace_id
        join lab.checkpoints c on c.id=v.checkpoint_id and c.workspace_id=r.workspace_id
        join lab.papers t on t.id=r.paper_id and t.workspace_id=r.workspace_id
        where r.workspace_id=%s and r.plan_id=any(%s::uuid[]) order by t.code,c.code,r.generator_provider,r.repeat_no""",(ws,ids))
    if not filters.get("include_fixture"):rows=[r for r in rows if r["cohort"] not in ("fixture","diagnostic")]
    transport=filters.get("transport","api")
    if transport:rows=[r for r in rows if r["transport"]==transport]
    for field in ("paper_id","checkpoint_revision_id","generator_provider"):
        if filters.get(field):rows=[r for r in rows if str(r[field])==str(filters[field])]
    if filters.get("repeat_no"):rows=[r for r in rows if r["repeat_no"]==int(filters["repeat_no"])]
    if not rows:return []
    run_ids=[r["id"] for r in rows]
    jobs=many(conn,"select * from lab.jobs where workspace_id=%s and run_id=any(%s::uuid[])",(ws,run_ids))
    jobs_by=defaultdict(list)
    accepted={}
    for j in jobs:
        jobs_by[str(j["run_id"])].append(j)
        if j["accepted_attempt_id"]:accepted[(str(j["run_id"]),j["phase"],j["judge_provider"])]=str(j["accepted_attempt_id"])
    corrected={str(a["id"]) for a in many(conn,"""select a.id from lab.attempts a join lab.jobs j on j.accepted_attempt_id=a.id
        where a.workspace_id=%s and j.run_id=any(%s::uuid[]) and a.normalized_settings->>'human_corrected'='true'""",(ws,run_ids))}
    tables={}
    for table in ("ideas","selections","usefulness_ratings","agreement_ratings"):
        tables[table]=many(conn,"select * from lab."+table+" where workspace_id=%s and run_id=any(%s::uuid[])",(ws,run_ids))
    indexed={name:defaultdict(list) for name in tables}
    for name,values in tables.items():
        for row in values:indexed[name][str(row["run_id"])].append(row)
    result=[]
    for run in rows:
        rid=str(run["id"])
        run["human_corrected"]=any(str(j["accepted_attempt_id"]) in corrected for j in jobs_by[rid])
        if run["human_corrected"] and not filters.get("include_human_corrected"):continue
        idea_rows=[i for i in indexed["ideas"][rid] if str(i["source_attempt_id"])==accepted.get((rid,"generate",None))]
        sels=[s for s in indexed["selections"][rid] if str(s["source_attempt_id"])==accepted.get((rid,"select",None))]
        selection=sels[0] if sels else None
        valid_u=[v for v in indexed["usefulness_ratings"][rid] if str(v["source_attempt_id"])==accepted.get((rid,"usefulness",v["judge_provider"]))]
        valid_m=[v for v in indexed["agreement_ratings"][rid] if str(v["source_attempt_id"])==accepted.get((rid,"agreement",v["judge_provider"]))]
        ideas=[]
        for i in sorted(idea_rows,key=lambda x:x["ordinal"]):
            u=sorted([v for v in valid_u if v["idea_ordinal"]==i["ordinal"]],key=lambda x:x["judge_provider"])
            m=sorted([v for v in valid_m if v["idea_ordinal"]==i["ordinal"]],key=lambda x:x["judge_provider"])
            ideas.append({**i,"candidate_id":"I"+str(i["ordinal"]),"u":[v["score"] for v in u],
                "match":[v["label"] for v in m],"usefulness_ratings":u,"agreement_ratings":m,
                "selected":bool(selection and selection["selected_ordinal"]==i["ordinal"])})
        met=metrics([{"id":i["candidate_id"],"u":i["u"],"match":i["match"]} for i in ideas],
                    "I"+str(selection["selected_ordinal"]) if selection else None)
        # Missing generated candidates must not make max()/any() eligible over a smaller set.
        if len(ideas)!=run["candidate_count"]:
            for field in ("best_usefulness","selection_regret","any_core_match"):met[field]=None
        group={"protocol":digest(run["frozen_config"]["protocol"]),"transport":run["transport"],
               "input_mode":run["input_mode"],"models":run["frozen_config"]["models"],"cohort":run["cohort"]}
        run.update(ideas=ideas,selection=selection,metrics=met,jobs=jobs_by[rid],
                   group_hash=digest(group),group_condition=group)
        result.append(run)
    return result

def summarize(rows,common=True,group_hash=None):
    groups={}
    for r in rows:groups.setdefault(r["group_hash"],r["group_condition"])
    selected=group_hash or next(iter(groups),None)
    selected_rows=[r for r in rows if r["group_hash"]==selected]
    return {"groups":[{"hash":k,"conditions":v} for k,v in groups.items()],"selected_group":selected,
            "comparison":"common" if common else "available","summary":aggregate(selected_rows,common),
            "eligibility":[{"run_id":r["id"],"paper_id":r["paper_id"],"revision_id":r["checkpoint_revision_id"],
                "provider":r["generator_provider"],"repeat_no":r["repeat_no"],"metrics":r["metrics"],
                "status":r["status"],"judges":list(r["judge_models"])} for r in selected_rows],
            "run_count":len(selected_rows),"analysis_hash":digest([selected,common,[str(r["id"]) for r in selected_rows]])}

