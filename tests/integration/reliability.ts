import assert from "node:assert/strict";
import { fixture } from "./fixture";
import { execute, reparse } from "../../supabase/functions/_shared/execution";
import { crypt } from "../../supabase/functions/_shared/runtime";
import { mock, stable } from "../../packages/contracts/core";
const f = await fixture();
await f.write("workspace_settings", { api_enabled: true });
const rev = await f.revision();
await f.write("budget_save", {
  provider: "anthropic",
  enabled: true,
  budget_usd: 8,
  org_verified: true,
});
await f.write("key_store", {
  provider: "anthropic",
  encrypted: await crypt(f.rt, f.w, "anthropic", "fixture-only-key"),
  last_four: "-key",
  request_hash: "fixture",
});
const m = await f.write("model_save", {
  provider: "anthropic",
  model_id: "fixture-model",
  api_family: "messages",
  parameters: {},
  output_cap: 4096,
  pricing: {
    input_per_million: 4,
    output_per_million: 20,
    max_request_usd: 0.5,
  },
});
const flight = await f.call("lab_preflight", {
  w: f.w,
  a: f.a,
  p: { model_ids: [m.id], revision_ids: [rev], mode: "probe" },
});
assert.equal(flight.rows.length, 4);
assert.ok(flight.rows.every((r: any) => !r.issues.length));
assert.ok(flight.rows.every((r: any) => r.total_tokens < 100000));
const probe = () =>
  f.call("lab_smoke_begin", {
    w: f.w,
    a: f.a,
    profile: m.id,
    revision: rev,
    probe_stage: "generate",
  });
await probe();
let claim = await f.call("lab_claim", { provider_name: "anthropic" });
assert.ok(claim, "$0.50 must admit a short text request");
await execute(
  {
    ...f.rt,
    fetch: async () =>
      Response.json({ error: { message: "invalid key" } }, { status: 401 }),
  },
  claim.attempt_id,
);
let c = await f.call("lab_context", { attempt: claim.attempt_id });
assert.equal(c.job.status, "blocked");
assert.equal(
  (
    await f.db.query<any>(
      "select reserved_usd from lab_private.usage_budgets where workspace_id=$1 and provider=$2",
      [f.w, "anthropic"],
    )
  ).rows[0].reserved_usd,
  "0",
);
assert.equal(
  (
    await f.db.query<any>(
      "select capabilities from lab.model_profiles where id=$1",
      [m.id],
    )
  ).rows[0].capabilities.stages.generate.status,
  "FAIL",
);
await f.write("provider_pause", { provider: "anthropic", paused: false });
await probe();
claim = await f.call("lab_claim", { provider_name: "anthropic" });
let fail = true,
  calls = 0;
const rt = {
  ...f.rt,
  fetch: async () => {
    calls++;
    return Response.json({
      id: "msg-realistic-fixture",
      model: "returned-fixture",
      stop_reason: "end_turn",
      content: [{ type: "text", text: stable(mock("generate", 1)) }],
      usage: { input_tokens: 40, output_tokens: 50 },
    });
  },
  rpc: async (name: string, args: any) => {
    if (name === "lab_attempt" && args.command === "complete" && fail) {
      fail = false;
      throw Error("SIMULATED_DB_INTERRUPTION");
    }
    return f.call(name, args);
  },
};
await execute(rt, claim.attempt_id);
c = await f.call("lab_context", { attempt: claim.attempt_id });
assert.equal(c.job.status, "parse_failed");
const spent = (
  await f.db.query<any>(
    "select spent_usd from lab_private.usage_budgets where workspace_id=$1",
    [f.w],
  )
).rows[0].spent_usd;
await reparse(rt, claim.attempt_id);
c = await f.call("lab_context", { attempt: claim.attempt_id });
assert.equal(c.job.status, "complete");
assert.equal(c.attempt.metadata.usage.input_tokens, 40);
assert.equal(c.attempt.metadata.returned_model, "returned-fixture");
assert.equal(calls, 1);
assert.equal(
  (
    await f.db.query<any>(
      "select spent_usd from lab_private.usage_budgets where workspace_id=$1",
      [f.w],
    )
  ).rows[0].spent_usd,
  spent,
);
await probe();
claim = await f.call("lab_claim", { provider_name: "anthropic" });
await execute(
  {
    ...rt,
    fetch: async () =>
      Response.json({
        id: "truncated",
        model: "fixture",
        stop_reason: "max_tokens",
        content: [{ type: "text", text: stable(mock("generate", 1)) }],
        usage: { input_tokens: 40, output_tokens: 50 },
      }),
  },
  claim.attempt_id,
);
c = await f.call("lab_context", { attempt: claim.attempt_id });
assert.equal(c.job.status, "blocked");
assert.equal(c.attempt.metadata.failure.code, "INCOMPLETE_OUTPUT");
assert.equal(
  (
    await f.db.query<any>(
      "select status from lab_private.quota_reservations where attempt_id=$1",
      [claim.attempt_id],
    )
  ).rows[0].status,
  "settled",
);
// A public budget change cannot increase the server spending cap.
await f.db.query(
  "update lab_private.server_budget_caps set limit_usd=0 where workspace_id=$1",
  [f.w],
);
await f.write("budget_save", {
  provider: "anthropic",
  enabled: true,
  budget_usd: 100,
  org_verified: true,
});
await probe();
assert.equal(await f.call("lab_claim", { provider_name: "anthropic" }), null);
assert.equal(
  (
    await f.db.query<any>(
      "select count(*) n from lab.jobs where last_error='SERVER_BUDGET_CAP'",
    )
  ).rows[0].n,
  1,
);
// Editing a recipe cannot keep the previous prepared asset, even via direct RPC.
const paper = await f.write("paper_create", { title: "PDF draft fixture" });
const cp = await f.write("checkpoint_create", {
  paper_id: paper.id,
  title: "PDF",
  body: {
    input_mode: "pdf",
    page_recipe: [{ page: 1, include: true }],
    prepared_asset_id: crypto.randomUUID(),
    prepared_sha256: "a".repeat(64),
  },
});
await f.write("revision_save", {
  id: cp.id,
  if_match: 1,
  body: {
    input_mode: "pdf",
    page_recipe: [{ page: 1, include: false }],
    prepared_asset_id: (
      await f.call("lab_read", {
        w: f.w,
        a: f.a,
        kind: "revision",
        args: { id: cp.id },
      })
    ).body.prepared_asset_id,
  },
});
assert.equal(
  (
    await f.call("lab_read", {
      w: f.w,
      a: f.a,
      kind: "revision",
      args: { id: cp.id },
    })
  ).body.prepared_asset_id,
  undefined,
);
console.log(
  "PASS short-text admission, 401 smoke FAIL + release, interrupted completion + no-call reparse, idempotent usage, truncated response rejection, server budget cap, PDF recipe invalidation",
);
await f.db.close();
