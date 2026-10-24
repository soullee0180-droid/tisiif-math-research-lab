import base64
import importlib.metadata
import json
from dataclasses import dataclass
from lab.providers.errors import ProviderFailure, classify

@dataclass
class ProviderResponse:
    text: str
    raw: dict
    model: str | None = None
    request_id: str | None = None
    usage: dict | None = None
    finish: str = "stop"

def validate_profile(profile):
    config=profile.get("config",{})
    if config.get("tools") or config.get("web_search") or config.get("code_execution") or config.get("sdk_auto_retries",0):
        raise ValueError("EXTERNAL_TOOLS_AND_SDK_RETRIES_FORBIDDEN")
    if any(config.get(k) for k in ("base_url","previous_response_id","conversation","cached_content")):
        raise ValueError("CUSTOM_ENDPOINT_OR_CONVERSATION_FORBIDDEN")
    allowed={"api_family","temperature","reasoning","max_visible_output_target_by_stage","sdk_auto_retries",
             "tools","store","api_version","sdk_version"}
    if set(config)-allowed: raise ValueError("UNSUPPORTED_PROFILE_FIELDS")
    provider=profile["provider"]
    family={"openai":"responses","google":"generate_content","anthropic":"messages"}[provider]
    if config.get("api_family",family)!=family: raise ValueError("INVALID_API_FAMILY")
    if provider=="openai" and config.get("store",False): raise ValueError("STORE_MUST_BE_FALSE")
    caps=config.get("max_visible_output_target_by_stage",{})
    if any(type(v) is not int or v<1 or v>200000 for v in caps.values()):
        raise ValueError("INVALID_OUTPUT_CAP")

def sdk_versions():
    return {p:importlib.metadata.version(p) for p in ("openai","anthropic","google-genai")}

def mock_send(packet):
    phase=packet["stage"]
    schema=packet["response_schema"]
    if phase=="select":
        obj={"selected_candidate_id":"C3","rationale_md":"Synthetic fixture selection.","risks_md":"Not a research result."}
    elif phase=="generate":
        k=schema["properties"]["ideas"]["maxItems"]
        obj={"ideas":[{"candidate_id":"I"+str(i),"title":"Fixture idea "+str(i),
            "idea_md":"Synthetic test idea. This is not mathematical research.",
            "why_helpful_md":"Verifies the research data pipeline.",
            "next_steps":["Check the supplied assumptions."],"assumptions":[],
            "unverified_points":["Synthetic fixture, not a theorem."]} for i in range(1,k+1)]}
    else:
        ids=schema["properties"]["ratings"]["items"]["properties"]["candidate_id"]["enum"]
        obj={"ratings":[]}
        for i,label in enumerate(ids):
            row={"candidate_id":label,"rationale_md":"Synthetic fixture judgment.","unable_reason":None}
            if phase=="usefulness": row.update(score=[3,4,2,4,1][i%5],validity="promising_unverified",concerns=[])
            else: row.update(label=["none","core","partial","none","none"][i%5],corresponding_elements=[])
            obj["ratings"].append(row)
    return ProviderResponse(json.dumps(obj),{"fixture":True,"text":json.dumps(obj)},"fixture-only",None,None)

class Adapter:
    def __init__(self,provider,key):
        self.provider=provider
        self.key=key

    def list_models(self):
        if self.provider=="openai":
            from openai import OpenAI
            with OpenAI(api_key=self.key,max_retries=0,timeout=30) as client:
                return [{"id":m.id} for m in client.models.list()]
        if self.provider=="anthropic":
            from anthropic import Anthropic
            with Anthropic(api_key=self.key,max_retries=0,timeout=30) as client:
                return [{"id":m.id} for m in client.models.list()]
        from google import genai
        from google.genai import types
        with genai.Client(api_key=self.key,http_options=types.HttpOptions(
                timeout=30000,retry_options=types.HttpRetryOptions(attempts=1))) as client:
            return [{"id":m.name.removeprefix("models/")} for m in client.models.list()]

    def send(self,packet,pdf=None):
        profile=packet["model_snapshot"]
        validate_profile(profile)
        cfg=profile["config"]
        cap=cfg.get("max_visible_output_target_by_stage",{}).get(packet["stage"],8000)
        reasoning=cfg.get("reasoning",{}).get("provider_parameters",{})
        try:
            if self.provider=="openai":
                from openai import OpenAI
                contents=[{"type":"input_text","text":packet["user_text"]}]
                if pdf: contents.append({"type":"input_file","filename":"context.pdf",
                    "file_data":"data:application/pdf;base64,"+base64.b64encode(pdf).decode()})
                kwargs={}
                if reasoning: kwargs["reasoning"]=reasoning
                if cfg.get("temperature") is not None: kwargs["temperature"]=cfg["temperature"]
                with OpenAI(api_key=self.key,max_retries=0,timeout=1800) as client:
                    out=client.responses.create(model=profile["model_id"],store=False,
                        input=[{"role":"system","content":packet["system_text"]},{"role":"user","content":contents}],
                        text={"format":{"type":"json_schema","name":packet["stage"],
                            "schema":packet["response_schema"],"strict":True}},
                        max_output_tokens=cap,**kwargs)
                raw=out.model_dump(mode="json")
                finish="truncated" if out.status=="incomplete" else "refused" if any(
                    c.get("type")=="refusal" for m in raw.get("output",[]) for c in m.get("content",[]) ) else "stop"
                return ProviderResponse(out.output_text,raw,out.model,getattr(out,"_request_id",None),
                    out.usage.model_dump(mode="json") if out.usage else None,finish)
            if self.provider=="anthropic":
                from anthropic import Anthropic
                blocks=[]
                if pdf: blocks.append({"type":"document","source":{"type":"base64","media_type":"application/pdf",
                    "data":base64.b64encode(pdf).decode()}})
                blocks.append({"type":"text","text":packet["user_text"]})
                kwargs={}
                if reasoning: kwargs["thinking"]=reasoning
                if cfg.get("temperature") is not None: kwargs["temperature"]=cfg["temperature"]
                with Anthropic(api_key=self.key,max_retries=0,timeout=1800) as client:
                    out=client.messages.create(model=profile["model_id"],max_tokens=cap,system=packet["system_text"],
                        messages=[{"role":"user","content":blocks}],
                        output_config={"format":{"type":"json_schema","schema":packet["response_schema"]}},**kwargs)
                txt="".join(c.text for c in out.content if c.type=="text")
                finish="truncated" if out.stop_reason=="max_tokens" else "refused" if out.stop_reason=="refusal" else "stop"
                return ProviderResponse(txt,out.model_dump(mode="json"),out.model,
                    getattr(out,"_request_id",None),out.usage.model_dump(mode="json"),finish)
            from google import genai
            from google.genai import types
            contents=[]
            if pdf: contents.append(types.Part.from_bytes(data=pdf,mime_type="application/pdf"))
            contents.append(packet["user_text"])
            conf=dict(system_instruction=packet["system_text"],response_mime_type="application/json",
                response_json_schema=packet["response_schema"],max_output_tokens=cap)
            if reasoning: conf["thinking_config"]=reasoning
            if cfg.get("temperature") is not None: conf["temperature"]=cfg["temperature"]
            with genai.Client(api_key=self.key,http_options=types.HttpOptions(
                timeout=1800000,retry_options=types.HttpRetryOptions(attempts=1))) as client:
                out=client.models.generate_content(model=profile["model_id"],contents=contents,
                    config=types.GenerateContentConfig(**conf))
            reason=str(out.candidates[0].finish_reason) if out.candidates else "BLOCKED"
            finish="truncated" if "MAX_TOKENS" in reason else "refused" if not out.candidates or "SAFETY" in reason else "stop"
            return ProviderResponse(out.text or "",out.model_dump(mode="json"),getattr(out,"model_version",None),
                getattr(out,"response_id",None),
                out.usage_metadata.model_dump(mode="json") if out.usage_metadata else None,finish)
        except ProviderFailure: raise
        except Exception as error:
            status=getattr(error,"status_code",None) or getattr(error,"code",None)
            response=getattr(error,"response",None)
            headers=dict(response.headers) if response is not None and hasattr(response,"headers") else {}
            body=getattr(error,"body",None) or getattr(error,"details",None) or type(error).__name__
            # Error body is classified internally; exception text/keys never leave this adapter.
            raise classify(status,body,headers) from None

    def check_remote_if_supported(self, request_id):
        # Synchronous inline requests have no retrievable background job handle.
        return {"supported":False,"reason":"이 요청 경로는 원격 결과 조회를 지원하지 않습니다."}

