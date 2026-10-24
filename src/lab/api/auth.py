import json
import hmac
import hashlib
from datetime import datetime, timezone
from uuid import UUID
import httpx
from fastapi import Header
from lab.config import settings
from lab.db import transaction, one
from lab.api.common import fail

def test_identity(token):
    cfg = settings()
    if cfg.app_env != "test" or not cfg.test_auth_secret or "." not in token: return None
    import base64
    payload, signature = token.rsplit(".", 1)
    expected = hmac.new(cfg.test_auth_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected): return None
    encoded = payload.rsplit('.', 1)[-1]
    try:
        data = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    except (ValueError, KeyError):
        return None
    if data["exp"] < datetime.now(timezone.utc).timestamp(): return None
    return data

def current_user(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "): fail("UNAUTHENTICATED", "로그인이 필요합니다.", 401)
    token = authorization[7:]
    cfg = settings()
    identity = test_identity(token)
    if identity is None:
        if not cfg.supabase_url or not cfg.supabase_publishable_key:
            fail("AUTH_NOT_CONFIGURED", "로그인 연결 설정이 필요합니다.", 503)
        try:
            with httpx.Client(timeout=15) as client:
                response = client.get(cfg.supabase_url + "/auth/v1/user",
                    headers={"Authorization": "Bearer " + token, "apikey": cfg.supabase_publishable_key})
            if response.status_code != 200: fail("SESSION_INVALID", "다시 로그인해 주세요.", 401)
            identity = response.json()
        except httpx.HTTPError:
            fail("AUTH_UNAVAILABLE", "로그인을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503)
        if not identity.get("email_confirmed_at"):
            fail("EMAIL_UNVERIFIED", "확인된 이메일 계정이 필요합니다.", 403)
    try: uid = UUID(identity["id"])
    except (ValueError, KeyError): fail("SESSION_INVALID", "다시 로그인해 주세요.", 401)
    email = identity.get("email", "").strip().lower()
    with transaction() as conn:
        workspace = one(conn, "select * from lab.workspaces where is_active and id=%s",
                        (cfg.default_workspace_id,))
        if not workspace: fail("WORKSPACE_NOT_READY", "연구 공간 설정이 필요합니다.", 503)
        allow = one(conn, "select * from lab_private.email_allowlist where workspace_id=%s and email=%s",
                    (workspace["id"], email))
        if not allow or not allow["active"]:
            fail("NOT_INVITED", "이 연구 공간에 초대되지 않은 계정입니다.", 403)
        # Role is stored server-side. user_metadata never determines authorization.
        display = email.split("@")[0]
        conn.execute("""insert into lab.workspace_members(workspace_id,user_id,email,display_name,role,active)
            values(%s,%s,%s,%s,%s,true)
            on conflict(workspace_id,user_id) do update set
            email=excluded.email,role=excluded.role,active=true""",
            (workspace["id"], uid, email, display, allow["role"]))
        member = one(conn, "select * from lab.workspace_members where workspace_id=%s and user_id=%s and active",
                     (workspace["id"], uid))
    return {**member, "workspace": workspace}

