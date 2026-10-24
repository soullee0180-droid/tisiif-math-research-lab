from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
import json
from uuid import UUID, uuid4
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from lab.config import settings

_pool = None
def pool():
    global _pool
    if _pool is None:
        cfg = settings()
        if not cfg.database_url:
            raise RuntimeError("DATABASE_URL is required")
        if cfg.app_env == "production" and "sslmode=verify-full" not in cfg.database_url:
            raise RuntimeError("Production DATABASE_URL must use sslmode=verify-full")
        _pool = ConnectionPool(cfg.database_url, min_size=0,
            max_size=4 if cfg.worker_name != "web" else 3, timeout=10,
            kwargs={"row_factory": dict_row}, open=True)
    return _pool

@contextmanager
def transaction():
    with pool().connection() as conn:
        with conn.transaction():
            yield conn

def one(conn, query, params=()):
    return conn.execute(query, params).fetchone()

def many(conn, query, params=()):
    return conn.execute(query, params).fetchall()

def value(v, key=None):
    return Jsonb(json.loads(json.dumps(v, default=serial))) if isinstance(v, dict) or isinstance(v, list) and key not in ('depends_on', 'plan_ids') else v

def insert(conn, table, row):
    schema, name = table.split(".")
    stmt = sql.SQL("insert into {}.{} ({}) values ({}) returning *").format(
        sql.Identifier(schema), sql.Identifier(name),
        sql.SQL(",").join(map(sql.Identifier, row)),
        sql.SQL(",").join(sql.Placeholder() for _ in row))
    return one(conn, stmt, tuple(value(v, k) for k, v in row.items()))

def update(conn, table, ident, workspace, fields):
    schema, name = table.split(".")
    stmt = sql.SQL("update {}.{} set {} where id=%s and workspace_id=%s returning *").format(
        sql.Identifier(schema), sql.Identifier(name),
        sql.SQL(",").join(sql.SQL("{}=%s").format(sql.Identifier(k)) for k in fields))
    return one(conn, stmt, tuple(value(v, k) for k, v in fields.items()) + (ident, workspace))

def serial(v):
    if isinstance(v, (UUID, datetime, date, Decimal)): return str(v)
    if isinstance(v, bytes): return v.hex()
    raise TypeError(type(v).__name__)

def audit(conn, user, action, kind, ident=None, detail=None):
    return insert(conn, "lab.audit_events", {
        "id": uuid4(), "workspace_id": user["workspace_id"],
        "actor_id": user.get("user_id"), "action": action,
        "object_type": kind, "object_id": ident, "safe_detail": detail or {}})

