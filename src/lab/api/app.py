import json
import hmac
from pathlib import Path
from uuid import uuid4, UUID
from fastapi import FastAPI, Request, Depends
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from lab.config import ROOT,settings
from lab.api import papers,experiments,reviews,admin,results
from lab.api.auth import current_user
from lab.api.common import fail,get
from lab.db import transaction
from lab.storage.client import Storage

class EnvelopeRoute(APIRoute):
    def get_route_handler(self):
        original=super().get_route_handler()
        async def handle(request):
            response=await original(request)
            if response.status_code<400 and response.media_type=="application/json":
                body=json.loads(response.body)
                return JSONResponse({"data":body,"request_id":request.state.request_id},
                    status_code=response.status_code,headers={k:v for k,v in response.headers.items() if k not in ("content-length","content-type")})
            return response
        return handle

def create_app():
    cfg=settings()
    if cfg.app_env=="production" and (cfg.local_storage_dir or cfg.test_auth_secret):
        raise RuntimeError("TEST_FACILITIES_MUST_NOT_BE_ENABLED_IN_PRODUCTION")
    app=FastAPI(title="TISIIF Math Research Lab",version="2.0.0",
                docs_url=None if cfg.app_env=="production" else "/docs",redoc_url=None,
                openapi_url=None if cfg.app_env=="production" else "/openapi.json")
    app.add_middleware(CORSMiddleware,allow_origins=[cfg.app_origin],
        allow_methods=["GET","POST","PATCH","PUT"],allow_headers=["Authorization","Content-Type","Idempotency-Key"])
    @app.middleware("http")
    async def requests(request,call_next):
        request.state.request_id=str(uuid4())
        response=await call_next(request)
        response.headers["X-Request-ID"]=request.state.request_id
        response.headers["X-Content-Type-Options"]="nosniff"
        response.headers["Referrer-Policy"]="no-referrer"
        response.headers["Permissions-Policy"]="camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"]="no-store"
        if cfg.app_env=="production":
            response.headers["Strict-Transport-Security"]="max-age=31536000"
            response.headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' "+cfg.supabase_url+" "+cfg.supabase_url.replace(".supabase.co",".storage.supabase.co")+"; frame-src 'self' "+cfg.supabase_url+"; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        return response
    @app.exception_handler(HTTPException)
    async def http_error(request,error):
        detail=error.detail if isinstance(error.detail,dict) else {"code":"HTTP_ERROR","message":str(error.detail),"details":{}}
        return JSONResponse({"error":detail,"request_id":getattr(request.state,"request_id",str(uuid4()))},status_code=error.status_code)
    @app.exception_handler(RequestValidationError)
    async def invalid_body(request,error):
        # Pydantic errors can contain the original input; NEVER return error.errors() wholesale.
        return JSONResponse({"error":{"code":"INVALID_INPUT","message":"입력 항목을 확인해 주세요.",
            "details":{"fields":[".".join(map(str,e["loc"])) for e in error.errors()]}},
            "request_id":request.state.request_id},status_code=422)
    @app.exception_handler(ValueError)
    async def value_error(request,error):
        code=str(error) if str(error).isupper() and len(str(error))<100 else "INVALID_INPUT"
        return JSONResponse({"error":{"code":code,"message":"입력 내용과 현재 상태를 확인해 주세요.","details":{}},
            "request_id":request.state.request_id},status_code=400)
    @app.exception_handler(Exception)
    async def internal_error(request,error):
        return JSONResponse({"error":{"code":"INTERNAL_ERROR","message":"처리를 완료하지 못했습니다. 요청 식별자와 함께 관리자에게 알려 주세요.","details":{}},
            "request_id":getattr(request.state,"request_id",str(uuid4()))},status_code=500)

    @app.get("/healthz")
    def healthz():return {"ok":True}
    @app.get("/api/public/config")
    def public_config():
        return {"data":{"supabase_url":cfg.supabase_url,"supabase_publishable_key":cfg.supabase_publishable_key,
                        "app_origin":cfg.app_origin,"build_sha":cfg.build_sha or None},"request_id":str(uuid4())}
    for router in (papers.router,experiments.router,reviews.router,admin.router,results.router):
        # Apply the envelope handler consistently without changing the specified endpoint routes.
        for route in router.routes:
            if isinstance(route,APIRoute):
                route.__class__=EnvelopeRoute
                route.app=__import__("starlette.routing",fromlist=["request_response"]).request_response(route.get_route_handler())
        app.include_router(router,prefix="/api/v1")

    @app.get("/api/v1/me")
    def me(request:Request,user=Depends(current_user)):
        return {"data":{k:user[k] for k in ("user_id","email","display_name","role","workspace_id","workspace")},
                "request_id":request.state.request_id}

    if cfg.app_env=="test" and cfg.local_storage_dir:
        @app.put("/api/v1/test-upload/{ident}")
        async def test_upload(ident:UUID,request:Request,user=Depends(current_user)):
            with transaction() as conn:asset=get(conn,"assets",ident,user["workspace_id"])
            if not hmac.compare_digest(request.headers.get("x-signature",""),Storage().test_signature(asset)):
                fail("UPLOAD_SIGNATURE_INVALID","업로드 서명이 올바르지 않습니다.",403)
            data=await request.body()
            if len(data)>104857600:fail("UPLOAD_TOO_LARGE","파일 크기를 확인해 주세요.",413)
            Storage().put(asset["bucket"],asset["object_path"],data,asset["mime_type"])
            return {"uploaded":True}
        @app.get("/api/v1/test-download/{ident}")
        def test_download(ident:UUID,signature:str,user=Depends(current_user)):
            with transaction() as conn:asset=get(conn,"assets",ident,user["workspace_id"])
            if not hmac.compare_digest(signature,Storage().test_signature(asset)):fail("DOWNLOAD_SIGNATURE_INVALID","다운로드 서명이 올바르지 않습니다.",403)
            return Response(Storage().get(asset),media_type=asset["mime_type"])
    dist=ROOT/"apps/web/dist"
    if (dist/"assets").exists():app.mount("/assets",StaticFiles(directory=dist/"assets"),name="static")
    @app.get("/{path:path}",include_in_schema=False)
    def spa(path:str):
        if path.startswith(("api/","assets/")):fail("NOT_FOUND","경로를 찾을 수 없습니다.",404)
        index=dist/"index.html"
        if not index.exists():
            return JSONResponse({"error":{"code":"FRONTEND_NOT_BUILT","message":"화면 빌드가 필요합니다.","details":{}}},status_code=503)
        return FileResponse(index)
    original_openapi=app.openapi
    envelope_documented=False
    def documented_openapi():
        nonlocal envelope_documented
        schema=original_openapi()
        if envelope_documented:return schema
        error_schema={"type":"object","required":["error","request_id"],"properties":{
            "error":{"type":"object","required":["code","message","details"],"properties":{
                "code":{"type":"string"},"message":{"type":"string"},"details":{"type":"object","additionalProperties":True}}},
            "request_id":{"type":"string","format":"uuid"}}}
        schema.setdefault("components",{}).setdefault("schemas",{})["ErrorEnvelope"]=error_schema
        for path,operations in schema["paths"].items():
            if not path.startswith("/api/v1/") or path=="/api/v1/me" or "/test-" in path:continue
            for operation in operations.values():
                if not isinstance(operation,dict) or "responses" not in operation:continue
                for code,response in list(operation["responses"].items()):
                    item=response.get("content",{}).get("application/json")
                    if code.startswith("2") and item is not None:
                        item["schema"]={"type":"object","required":["data","request_id"],"properties":{
                            "data":item.get("schema",{}),"request_id":{"type":"string","format":"uuid"}}}
                for code in ("400","401","403","404","409","422","429","500","503"):
                    operation["responses"][code]={"description":"Request error","content":{"application/json":{"schema":{"$ref":"#/components/schemas/ErrorEnvelope"}}}}
        envelope_documented=True
        return schema
    app.openapi=documented_openapi
    return app

app=create_app()

