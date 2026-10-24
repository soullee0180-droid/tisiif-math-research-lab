"""Validate the specification itself, NOT a completed app or live service.

Run: uv run --with jsonschema --with pglast python verification/check_contracts.py
Use --write-report to save the results. Requires no API keys and does not contact
AI providers, Supabase, GitHub, Render, or Google accounts.
"""
from pathlib import Path
import copy
import hashlib
import json
import re
import sys
import jsonschema
from pglast import parse_sql, parse_plpgsql

ROOT=Path(__file__).resolve().parents[1]
checks=[]
def check(name,condition,detail=""):
 checks.append({"name":name,"passed":bool(condition),"detail":detail})
 if not condition: raise AssertionError(name+": "+detail)
def read(p):return json.loads((ROOT/p).read_text(encoding="utf-8"))

json_files=sorted(ROOT.rglob("*.json"))
for p in json_files:
 json.loads(p.read_text(encoding="utf-8"))
check("all_json_parses",True,str(len(json_files))+" JSON files")
protocol=read("contracts/research-protocol.json")
check("default_K_R",protocol["candidate_count"]==5 and protocol["independent_repeats"]==2)
check("six_logical_stages",len(protocol["stages"])==6)
check("bulk_job_count",100*2*3*2*len(protocol["stages"])==7200)
check("pilot_fixture_job_count",3*1*3*2*len(protocol["stages"])==108)

schemas={name:read("contracts/schemas/"+name+".schema.json")
 for name in ["generate","select","usefulness","agreement"]}
for name,schema in schemas.items():
 jsonschema.Draft202012Validator.check_schema(schema)
check("four_valid_json_schemas",len(schemas)==4)

generation={"ideas":[{"candidate_id":f"I{i}","title":f"Fixture idea {i}",
 "idea_md":"Synthetic test data; not a research result.",
 "why_helpful_md":"A fixture to verify record and score mapping.",
 "next_steps":["Check the supplied assumptions."],"assumptions":[],
 "unverified_points":["This fixture is not a proved claim."]} for i in range(1,6)]}
selection={"selected_candidate_id":"C3","rationale_md":"Fixture selection.","risks_md":"Synthetic."}
u={"ratings":[{"candidate_id":f"C{i}","score":v,"validity":"promising_unverified",
 "rationale_md":"Fixture score.","concerns":[],"unable_reason":None}
 for i,v in enumerate([3,4,2,4,1],1)]}
m={"ratings":[{"candidate_id":f"C{i}","label":v,"rationale_md":"Fixture label.",
 "corresponding_elements":[],"unable_reason":None}
 for i,v in enumerate(["none","core","partial","none","none"],1)]}
for name,value in [("generate",generation),("select",selection),("usefulness",u),("agreement",m)]:
 jsonschema.validate(value,schemas[name])
check("four_valid_fixture_responses",True)

def semantic(name,value):
 jsonschema.validate(value,schemas[name])
 if name=="generate":
  ids=[r["candidate_id"] for r in value["ideas"]]
  assert len(ids)==5 and set(ids)==set("I"+str(i) for i in range(1,6))
 if name in ("usefulness","agreement"):
  ids=[r["candidate_id"] for r in value["ratings"]]
  assert len(ids)==5 and set(ids)==set("C"+str(i) for i in range(1,6))
  for r in value["ratings"]:
   if name=="usefulness":
    assert r["score"] is None or (type(r["score"]) is int and 0<=r["score"]<=4)
    if r["score"] is None:assert r["unable_reason"] and r["unable_reason"].strip()
   elif r["label"]=="undetermined":
    assert r["unable_reason"] and r["unable_reason"].strip()
def rejects(name,value):
 try:semantic(name,value)
 except (AssertionError,jsonschema.ValidationError):return True
 return False
bad=copy.deepcopy(generation);bad["ideas"].pop()
check("missing_candidate_rejected",rejects("generate",bad))
bad=copy.deepcopy(generation);bad["ideas"][4]["candidate_id"]="I1"
check("duplicate_candidate_rejected",rejects("generate",bad))
bad=copy.deepcopy(u);bad["ratings"][0]["score"]=7
check("out_of_range_score_rejected",rejects("usefulness",bad))
bad=copy.deepcopy(u);bad["ratings"][0]["score"]=None
check("null_without_reason_rejected",rejects("usefulness",bad))
bad=copy.deepcopy(m);bad["ratings"][0]["label"]="undetermined"
check("undetermined_without_reason_rejected",rejects("agreement",bad))
check("unknown_selected_id_rejected",rejects("select",dict(selection,selected_candidate_id="C9")))

def metrics(ideas,selected):
 U={x["id"]:(sum(x["u"])/2 if all(v is not None for v in x["u"]) else None) for x in ideas}
 M={x["id"]:(int(all(v=="core" for v in x["match"]))
  if all(v in ("none","partial","core") for v in x["match"]) else None) for x in ideas}
 su=U.get(selected);best=max(U.values()) if all(v is not None for v in U.values()) else None
 return {"selected_usefulness":su,"best_usefulness":best,
  "selection_regret":None if su is None or best is None else best-su,
  "any_core_match":int(any(M.values())) if all(v is not None for v in M.values()) else None,
  "selected_core_match":M.get(selected)}
case=read("fixtures/metric_cases.json")
actual=metrics(case["ideas"],case["selected"])
check("metric_M01",actual=={k:v for k,v in case["expected"].items() if k!="review_flags"},str(actual))
flags=[x["id"] for x in case["ideas"] if all(v is not None for v in x["u"]) and abs(x["u"][0]-x["u"][1])>=2]
check("disagreement_flag",flags==case["expected"]["review_flags"])
for variant in case["variants"]:
 ideas=copy.deepcopy(case["ideas"])
 for field,value in variant.get("patch",{}).items():
  ident,key=field.split(".")
  next(x for x in ideas if x["id"]==ident)[key]=value
 got=metrics(ideas,variant.get("selected",case["selected"]))
 check("metric_"+variant["case_id"],got==variant["expected"],str(got))
# A paper with ten checkpoints must not acquire ten times the paper weight.
paper_means=[sum([4]*10)/10,sum([0])/1]
check("paper_equal_weight_fixture",sum(paper_means)/len(paper_means)==2)

for name in ["generate","select","usefulness","agreement"]:
 p=read("contracts/prompts/"+name+".json")
 vars=set(re.findall(r"\{\{([A-Z_]+)\}\}",p["user_template"]))
 expected={"PUBLIC_CONTEXT","TASK"}
 if name=="generate":expected|={"K"}
 else:expected|={"CANDIDATES"}
 if name=="agreement":expected|={"REFERENCE"}
 check("template_variables_"+name,vars==expected,str(sorted(vars)))
 check("reference_boundary_"+name,("{{REFERENCE}}" in p["user_template"])==(name=="agreement"))

# Check the declared stable C-label mapping (transport-independent).
seed="unit-fixture-seed"
ids=["I1","I2","I3","I4","I5"]
order=sorted(ids,key=lambda i:hashlib.sha256((seed+":"+i).encode()).hexdigest())
mapping={f"C{i}":ident for i,ident in enumerate(order,1)}
check("display_mapping_bijection",len(set(mapping.values()))==5)
check("display_mapping_roundtrip",all({v:k for k,v in mapping.items()}[v]==k for k,v in mapping.items()))

sql=(ROOT/"contracts/001_schema.sql").read_text()
parsed=parse_sql(sql)
check("postgres_schema_syntax",len(parsed)>50,str(len(parsed))+" parsed top-level statements; no live DB applied")
functions=re.findall(r"create function .*?\$f\$;",sql,re.S|re.I)
for statement in functions:
 if "language plpgsql" in statement:
  name=re.search(r"create function\s+([^\s(]+)",statement,re.I).group(1)
  parse_plpgsql(statement)
  check("plpgsql_syntax:"+name,True)
claim=(ROOT/"contracts/002_claim_job.sql").read_text().replace("%(provider)s","'openai'").replace("%(worker)s","'test-worker'")
check("postgres_claim_syntax",len(parse_sql(claim))==1)
tables=re.findall(r"create table (lab(?:_private)?\.\w+)",sql,re.I)
check("tables_unique",len(tables)==len(set(tables)),str(len(tables))+" tables")
check("source_and_prepared_distinct","'lab-source'" in sql and "'lab-prepared'" in sql)
check("rls_declared","enable row level security" in sql.lower() and "lab_private.is_member(workspace_id)" in sql)
check("snapshot_guard_declared","PLAN_SNAPSHOT_IMMUTABLE" in sql and "RUN_SNAPSHOT_IMMUTABLE" in sql)
check("null_reason_sql_guard","coalesce(length(unable_reason),0)>0" in sql)

tokens=read("contracts/ui-tokens.json")
check("desktop_content_geometry",1440-tokens["shell"]["sidebar_px"]-2*tokens["shell"]["main_padding_px"]==1176)
check("main_navigation_order",[x["label"] for x in tokens["sidebar"]]==["논문","실험","진행 상황","결과"])
check("public_env_has_no_secret",not set(read("contracts/env-contract.json")["browser_public"])
 &set(read("contracts/env-contract.json")["never_in_browser"]))

master=(ROOT/"01_MASTER_PROMPT.md").read_text(encoding="utf-8")
# If the assembled appendix exists, verify it is identical to every source file.
embedded=re.findall(r"<!-- CANONICAL_FILE: (.*?) -->\n~~~[^\n]*\n(.*?)\n~~~",master,re.S)
if embedded:
 for path,content in embedded:
  check("embedded:"+path,content.rstrip("\n")==(ROOT/path).read_text(encoding="utf-8").rstrip("\n"))
 check("all_contracts_embedded",set(p for p,_ in embedded)>=set(
  str(p.relative_to(ROOT)) for p in (ROOT/"contracts").rglob("*") if p.is_file()))

report={"report_kind":"specification_static_and_fixture_validation","date":"2026-10-23",
 "all_passed":all(x["passed"] for x in checks),"checks":checks,
 "not_performed":["live Supabase migration and RLS/Storage execution","cloud deployment",
 "Google OAuth login","actual provider requests","completed app UI/E2E testing"],
 "important":"This validates the prompt package, not a built application."}
if "--write-report" in sys.argv:
 (ROOT/"verification/validation-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"passed":len(checks),"all_passed":report["all_passed"],"embedded_files":len(embedded),
 "live_services_tested":False},ensure_ascii=False))
