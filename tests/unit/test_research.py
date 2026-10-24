import copy
import json
from uuid import uuid4
import pytest
from lab.domain.research import definition,assemble,parse_output,metrics,aggregate,canonical,digest,public_context,PROVIDERS
from lab.providers.adapters import mock_send,validate_profile
from lab.config import ROOT

def setup(k=5):
    rid=str(uuid4());rev=str(uuid4());proto=definition();proto["candidate_count"]=k
    model={"provider":"google","model_id":"fixture","config":{},"capabilities":{}}
    run={"id":rid,"checkpoint_revision_id":rev,"generator_model":model,
         "judge_models":{p:{**model,"provider":p} for p in ("openai","anthropic")},
         "candidate_count":k,"generator_provider":"google"}
    frozen={"protocol":proto,"inputs":{rev:{"public_context":{"public_text":"Public mathematics"},
        "goal":"Prove the target","obstacle":"Unclosed recurrence","prepared_asset_id":None,"hash":"a"*64}},
        "references":{rev:"HIDDEN_CANARY_ONLY_AGREEMENT"}}
    gen=mock_send(assemble(run,"generate",None,frozen,[]))
    ideas=[{**r,"ordinal":int(r["candidate_id"][1:])} for r in json.loads(gen.text)["ideas"]]
    return run,frozen,ideas

@pytest.mark.parametrize("phase,judge",[("generate",None),("select",None),("usefulness","openai"),("agreement","anthropic")])
@pytest.mark.parametrize("k",[1,3,5,10])
def test_schema_and_mock_for_every_stage(phase,judge,k):
    run,frozen,ideas=setup(k);packet=assemble(run,phase,judge,frozen,ideas)
    output=mock_send(packet)
    parse_output(output.text,phase,frozen["protocol"],k)

@pytest.mark.parametrize("phase,judge",[("generate",None),("select",None),("usefulness","openai")])
def test_reference_never_leaks(phase,judge):
    run,frozen,ideas=setup()
    packet=assemble(run,phase,judge,frozen,ideas)
    assert "HIDDEN_CANARY" not in canonical(packet)
    assert not any(x in packet["user_text"] for x in ('generator_provider','generator_model','selected_ordinal'))
    assert "authorization" not in packet and "api_key" not in packet

def test_reference_present_only_in_agreement():
    run,frozen,ideas=setup()
    assert "HIDDEN_CANARY" in assemble(run,"agreement","openai",frozen,ideas)["user_text"]

def test_display_labels_are_reproducible_bijection():
    run,frozen,ideas=setup()
    p=assemble(run,"select",None,frozen,ideas)
    assert p==assemble(run,"select",None,frozen,ideas)
    assert set(p["display_to_canonical"])=={"C1","C2","C3","C4","C5"}
    assert set(p["display_to_canonical"].values())=={"I1","I2","I3","I4","I5"}
    assert p['user_text'] != assemble(run,'usefulness','openai',frozen,ideas)['user_text']

def test_public_dto_excludes_hidden_fields():
    rev={"abstract_md":"","public_text_md":"Public","input_mode":"text",
         "source_asset_id":str(uuid4()),"reference_idea_md":"CANARY","reference_location":"CANARY",
         "stage_outline":[{"index":1,"title":"Public","body_md":"known","is_public":True},
                          {"index":2,"title":"Hidden","body_md":"CANARY","is_public":False}]}
    assert "CANARY" not in canonical(public_context(rev))

def test_metric_contract_cases():
    c=json.loads((ROOT/"fixtures/metric_cases.json").read_text())
    assert metrics(c["ideas"],c["selected"])==c["expected"]
    for variant in c["variants"]:
        ideas=copy.deepcopy(c["ideas"])
        for key,val in variant.get("patch",{}).items():
            ident,field=key.split(".");next(x for x in ideas if x["id"]==ident)[field]=val
        got=metrics(ideas,variant.get("selected",c["selected"]))
        assert {k:v for k,v in got.items() if k!="review_flags"}==variant["expected"]

def test_paper_weight_is_equal():
    rows=[]
    for cp in range(10):
        rows.append(dict(id=str(uuid4()),paper_id="a",checkpoint_revision_id=str(cp),repeat_no=1,
            generator_provider="google",metrics={m:4 for m in ("selected_usefulness","best_usefulness","selection_regret","any_core_match","selected_core_match")}))
    rows.append(dict(id=str(uuid4()),paper_id="b",checkpoint_revision_id="b",repeat_no=1,
        generator_provider="google",metrics={m:0 for m in ("selected_usefulness","best_usefulness","selection_regret","any_core_match","selected_core_match")}))
    assert aggregate(rows,False)["google"]["selected_usefulness"]["value"]==2
    assert aggregate(rows,True)["google"]["selected_usefulness"]["value"] is None

@pytest.mark.parametrize("change",["missing","duplicate","bad_score","null_no_reason","invalid_id"])
def test_invalid_responses_rejected(change):
    run,frozen,ideas=setup()
    phase="generate" if change in ("missing","duplicate") else "select" if change=="invalid_id" else "usefulness"
    packet=assemble(run,phase,None if phase!="usefulness" else "openai",frozen,ideas)
    data=json.loads(mock_send(packet).text)
    if change=="missing":data["ideas"].pop()
    elif change=="duplicate":data["ideas"][1]["candidate_id"]="I1"
    elif change=="bad_score":data["ratings"][0]["score"]=7
    elif change=="null_no_reason":data["ratings"][0]["score"]=None
    else:data["selected_candidate_id"]="C9"
    with pytest.raises(Exception):parse_output(json.dumps(data),phase,frozen["protocol"],5)

@pytest.mark.parametrize("config",[{"tools":[{}]},{"web_search":True},{"store":True},
                                    {"previous_response_id":"x"},{"base_url":"https://example.com"},{"sdk_auto_retries":2}])
def test_profile_does_not_allow_research_side_channels(config):
    with pytest.raises(ValueError):validate_profile({"provider":"openai","config":config})

def test_no_commentary_json_repair():
    run,frozen,ideas=setup()
    response=mock_send(assemble(run,"select",None,frozen,ideas)).text
    assert parse_output("```json\n"+response+"\n```","select",frozen["protocol"],5)
    with pytest.raises(Exception):parse_output("Here is my answer:\n"+response,"select",frozen["protocol"],5)

