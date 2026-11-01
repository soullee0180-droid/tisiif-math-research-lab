import assert from "node:assert/strict";
import { database, rpc } from "./harness";
import protocol from "../../packages/contracts/research-protocol.json";
const legacyWorkspace = crypto.randomUUID(),
  legacyPlan = crypto.randomUUID();
const legacyProtocol = { version: 4, stage_prompts: { generate: "Original" } };
const db = await database(async (db, file) => {
  if (file !== "20261029010000_reliability.sql") return;
  await db.query(
    "insert into lab.workspaces(id,name) values($1,'Legacy fixture')",
    [legacyWorkspace],
  );
  await db.query(
    "insert into lab.plans(id,workspace_id,created_by,name,k,repeats,cohort,transport,status,protocol,condition_hash) values($1,$2,$3,'Legacy plan',1,1,'pilot','api','running',$4,'legacy-hash')",
    [legacyPlan, legacyWorkspace, crypto.randomUUID(), legacyProtocol],
  );
});
const legacy = (
  await db.query<any>(
    "select protocol,condition_hash,status from lab.plans where id=$1",
    [legacyPlan],
  )
).rows[0];
assert.deepEqual(legacy.protocol, legacyProtocol);
assert.equal(legacy.condition_hash, "legacy-hash");
assert.equal(legacy.status, "paused");
await assert.rejects(
  db.query("update lab.plans set protocol='{}' where id=$1", [legacyPlan]),
  /IMMUTABLE_PLAN_SNAPSHOT/,
);
const call = rpc(db);
const w = crypto.randomUUID(),
  a = crypto.randomUUID(),
  b = crypto.randomUUID();
await db.query(
  "insert into lab.workspaces(id,name,active) values($1,$2,true)",
  [w, "Local fixture only"],
);
await db.query(
  "insert into lab_private.email_allowlist values($1,'admin@fixture.invalid','admin',true),($1,'team@fixture.invalid','researcher',true)",
  [w],
);
await db.query(
  "insert into lab.protocol_versions(workspace_id,body,sha256) values($1,$2,$3)",
  [w, protocol, "fixture"],
);
await db.query(
  "insert into lab.members(workspace_id,id,id_email,role) values($1,$2,'admin@fixture.invalid','admin'),($1,$3,'team@fixture.invalid','researcher')",
  [w, a, b],
);
const write = (action: string, p: any, actor = a, key = crypto.randomUUID()) =>
  call("lab_write", { w, a: actor, action, p, idem: key });
await db.query(
  "insert into lab.members(workspace_id,id,id_email,role) values($1,$2,'legacy@fixture.invalid','admin')",
  [legacyWorkspace, a],
);
await assert.rejects(
  call("lab_write", {
    w: legacyWorkspace,
    a,
    action: "plan_control",
    p: { id: legacyPlan, status: "running" },
    idem: crypto.randomUUID(),
  }),
  /LEGACY_PLAN_RECREATE_REQUIRED/,
);
const paper = await write("paper_create", { title: "Synthetic test paper" });
const cp = await write("checkpoint_create", {
  paper_id: paper.id,
  title: "Synthetic checkpoint",
  body: {
    input_mode: "text",
    goal: "Fixture goal",
    obstacle: "Fixture obstacle",
    public_text: "PUBLIC_CANARY",
    reference_idea_md: "SECRET_CANARY",
    reference_location: "page 1",
    steps: [],
  },
});
await assert.rejects(
  write("revision_approve", { id: cp.id, if_match: 1 }),
  /APPROVAL_CHECKS_REQUIRED/,
);
await write("revision_approve", {
  id: cp.id,
  if_match: 1,
  checks: [true, true, true],
});
await assert.rejects(
  write("revision_save", { id: cp.id, if_match: 2, body: {} }),
  /IMMUTABLE/,
);
assert.equal(
  (
    await call("lab_read", {
      w,
      a,
      kind: "papers",
      args: { cursor: "", search: "" },
    })
  ).rows.length,
  1,
);
const key = crypto.randomUUID();
const first = await write("paper_create", { title: "Replay" }, a, key);
assert.deepEqual(
  await write("paper_create", { title: "Replay" }, a, key),
  first,
);
await assert.rejects(
  write("paper_create", { title: "Mismatch" }, a, key),
  /IDEMPOTENCY_CONFLICT/,
);
const plan = await write("plan_create", {
  name: "Fixture 36 jobs",
  k: 5,
  repeats: 2,
  cohort: "fixture",
  transport: "mock",
  revision_ids: [cp.id],
});
await assert.rejects(
  write("plan_control", { id: plan.id, status: "running" }, b),
  /FORBIDDEN/,
);
await write("plan_control", { id: plan.id, status: "running" });
const count = await db.query("select count(*)::integer n from lab.jobs");
assert.equal((count.rows[0] as any).n, 36);
await db.exec("set role anon");
await assert.rejects(
  call("lab_read", { w, a, kind: "papers", args: {} }),
  /permission denied/,
);
await db.exec("reset role");
console.log(
  "PASS SQL schema, immutable revision, idempotency, ownership, 6-stage plan and direct RPC denial",
);
await db.close();
