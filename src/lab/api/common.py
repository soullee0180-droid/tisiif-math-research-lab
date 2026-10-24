import json
from uuid import UUID
from fastapi import HTTPException, Request
from lab.db import one, insert, value
from lab.domain.research import digest

def fail(code, message, status=400, details=None):
    raise HTTPException(status, {"code": code, "message": message, "details": details or {}})

def get(conn, table, ident, workspace, lock=False):
    # Only static table names from server routes are accepted.
    if table not in {
        "papers", "assets", "checkpoints", "checkpoint_revisions", "plans", "runs", "jobs",
        "exports", "review_assignments", "review_batches", "model_profiles", "protocol_versions"}:
        raise ValueError("INVALID_SERVER_TABLE")
    row = one(conn, "select * from lab." + table + " where id=%s and workspace_id=%s" +
              (" for update" if lock else ""), (ident, workspace))
    if not row: fail("NOT_FOUND", "자료를 찾을 수 없습니다.", 404)
    return row

def with_hash(row):
    return {**row, "content_hash": digest(row)}

def require_admin(user):
    if user["role"] != "admin": fail("FORBIDDEN", "접근 권한이 없습니다.", 403)

def control(user, plan):
    if user["role"] != "admin" and str(plan["created_by"]) != str(user["user_id"]):
        fail("FORBIDDEN", "이 실험을 제어할 권한이 없습니다.", 403)

def idempotent(conn, request, user, payload, action):
    key = request.headers.get("Idempotency-Key", "")
    try: key = UUID(key)
    except ValueError: fail("IDEMPOTENCY_KEY_REQUIRED", "요청 식별자가 필요합니다.")
    route = request.method + " " + request.url.path
    sha = digest(payload)
    # Serialize identical submissions, then persist the result in the SAME transaction as all writes.
    conn.execute("select pg_advisory_xact_lock(hashtextextended(%s,0))",
                 (str(user["workspace_id"]) + ":" + str(user["user_id"]) + ":" + route + ":" + str(key),))
    existing = one(conn, """select * from lab_private.idempotency_requests
        where workspace_id=%s and actor_id=%s and request_key=%s and route=%s for update""",
        (user["workspace_id"], user["user_id"], key, route))
    if existing:
        if existing["body_sha256"] != sha:
            fail("IDEMPOTENCY_CONFLICT", "같은 요청 식별자에 다른 내용이 들어 있습니다.", 409)
        return existing["safe_response"]
    result = action(key)
    from lab.db import serial
    result = json.loads(json.dumps(result, default=serial))
    insert(conn, "lab_private.idempotency_requests", dict(workspace_id=user["workspace_id"],
        actor_id=user["user_id"], request_key=key, route=route, body_sha256=sha, safe_response=result))
    return result

def check_hash(row, expected):
    if digest(row) != expected:
        fail("EDIT_CONFLICT", "다른 팀원이 변경했습니다. 최신 내용을 확인해 주세요.", 409,
             {"current_hash": digest(row)})

