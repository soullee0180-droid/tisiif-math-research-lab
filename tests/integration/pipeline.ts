import assert from "node:assert/strict";
import { fixture } from "./fixture";
import {
  execute,
  manualPrompt,
  manualSubmit,
  reparse,
} from "../../supabase/functions/_shared/execution";
import { providers, stable, sha } from "../../packages/contracts/core";
import { runMetrics } from "../../packages/metrics";
import {
  sections,
  leaf,
  tree,
  proof,
} from "../../packages/contracts/integrity";
const f = await fixture();
const revision = await f.revision();
const plan = await f.write("plan_create", {
  name: "36 job fixture",
  k: 5,
  repeats: 2,
  cohort: "fixture",
  transport: "mock",
  revision_ids: [revision],
});
await f.write("plan_control", { id: plan.id, status: "running" });
let completed = 0;
for (let round = 0; round < 40; round++) {
  let claimed = 0;
  for (const provider of providers) {
    const job = await f.call("lab_claim", { provider_name: provider });
    if (!job) continue;
    assert.equal(
      await f.call("lab_claim", { provider_name: provider }),
      null,
      "global concurrency=1",
    );
    await execute(f.rt, job.attempt_id);
    claimed++;
    completed++;
  }
  if (!claimed) break;
}
assert.equal(completed, 36);
assert.equal(f.objects.size, 72);
assert.equal(f.networkCalls(), 0);
const results = await f.call("lab_read", {
  w: f.w,
  a: f.b,
  kind: "results",
  args: { plan_ids: [plan.id] },
});
assert.equal(results.runs.length, 6);
assert.ok(results.runs.every((r: any) => r.ideas.length === 5));
for (const at of results.attempts) {
  const j = results.jobs.find((j: any) => j.id === at.job_id);
  const text = stable(at.request_snapshot.dto);
  assert.ok(!text.includes("SECRET_STEP"));
  if (j.stage !== "agreement") assert.ok(!text.includes("SECRET_CANARY"));
  assert.ok(!text.includes("fixture page 1"));
  assert.ok(at.completed_at);
}
const snapshot = await f.write("analysis_create", { plan_ids: [plan.id] });
const saved = await f.db.query(
  "select sha256 from lab.analysis_snapshots where id=$1",
  [snapshot.id],
);
assert.equal((saved.rows[0] as any).sha256, snapshot.sha256);
const sample = await f.call("lab_review_sample", {
  w: f.w,
  a: f.a,
  filters: { plan_ids: [plan.id] },
  reviewers: [f.a, f.b],
});
assert.equal(sample.manifest.length, 6);
const review = await f.call("lab_read", {
  w: f.w,
  a: f.b,
  kind: "review",
  args: {},
});
assert.ok(review.length);
assert.equal(review[0].reference, null);
assert.ok(!stable(review[0]).includes("generator"));
await f.write(
  "review_submit",
  {
    id: review[0].id,
    phase: "usefulness",
    body: { score: 2, rationale_md: "Independent first score" },
  },
  f.b,
);
const later = await f.call("lab_read", {
  w: f.w,
  a: f.b,
  kind: "review",
  args: {},
});
assert.equal(
  later.find((r: any) => r.id === review[0].id).reference,
  "SECRET_CANARY",
);
const manual = await f.write("plan_create", {
  name: "manual fixture context",
  k: 1,
  repeats: 1,
  cohort: "pilot",
  transport: "manual_web",
  revision_ids: [revision],
});
await f.write("plan_control", { id: manual.id, status: "running" });
const jobs = await f.db.query(
  "select id from lab.jobs where plan_id=$1 and stage='generate' limit 1",
  [manual.id],
);
const prompt = await manualPrompt(f.rt, f.w, f.a, (jobs.rows[0] as any).id);
await assert.rejects(
  manualSubmit(f.rt, f.w, f.a, prompt.attempt_id, { raw: "invalid JSON" }),
);
const context = await f.call("lab_context", { attempt: prompt.attempt_id });
assert.ok(context.attempt.response_asset_id);
assert.equal(context.job.status, "parse_failed");
const before = f.networkCalls();
await assert.rejects(reparse(f.rt, prompt.attempt_id));
assert.equal(f.networkCalls(), before);
// A send-started lease can never be silently re-queued.
const other = await f.write("plan_create", {
  name: "lease fixture",
  k: 1,
  repeats: 1,
  cohort: "fixture",
  transport: "mock",
  revision_ids: [revision],
});
await f.write("plan_control", { id: other.id, status: "running" });
const claim = await f.call("lab_claim", { provider_name: "google" });
await f.db.query(
  "update lab.attempts set send_started_at=now(),milestone='send_started' where id=$1",
  [claim.attempt_id],
);
await f.db.query(
  "update lab.jobs set lease_until=now()-interval '1 second' where id=$1",
  [claim.job_id],
);
await f.call("lab_recover", {});
const unknown = await f.db.query("select status from lab.jobs where id=$1", [
  claim.job_id,
]);
assert.equal((unknown.rows[0] as any).status, "unknown_remote");
// Full business backup -> new inactive workspace; every persisted raw byte is copied and hashed.
const backup = await f.write("backup_create", {});
backup.body = { workspace: backup.workspace, sections: {} };
for (const section of sections) {
  backup.body.sections[section] = (
    await f.call("lab_read", {
      w: f.w,
      a: f.a,
      kind: "backup_rows",
      args: { id: backup.id, section },
    })
  ).rows;
}
const manifests: any = {};
for (const s of sections) {
  const hashes = await Promise.all(
    backup.body.sections[s].map((r: any, i: number) => leaf(s, i, r)),
  );
  manifests[s] = { count: hashes.length, ...(await tree(hashes)) };
}
const session = await f.call("lab_restore_begin", {
  w: f.w,
  a: f.a,
  manifest: {
    format: "tisiif-backup-v3",
    verified_by_edge: true,
    workspace_id: f.w,
    storage_bytes: [...f.objects.values()].reduce((n, v) => n + v.length, 0),
    sections: Object.fromEntries(
      sections.map((s) => [
        s,
        { count: manifests[s].count, root: manifests[s].root },
      ]),
    ),
  },
});
for (const section of sections)
  for (let index = 0; index < backup.body.sections[section].length; index++) {
    const row = backup.body.sections[section][index];
    await f.call("lab_restore_chunk", {
      w: f.w,
      a: f.a,
      session: session.id,
      section,
      rows: [
        {
          row,
          index,
          hash: await leaf(section, index, row),
          proof: proof(manifests[section].levels, index),
        },
      ],
      proof_verified: true,
    });
  }
for (const asset of backup.body.sections.assets.filter(
  (a: any) => a.status === "verified",
)) {
  const target = await f.call("lab_restore_file", {
    w: f.w,
    a: f.a,
    session: session.id,
    old_asset: asset.id,
    verified_hash: null,
  });
  const bytes = await f.rt.get(asset.kind, asset.path);
  await f.rt.put(target.kind, target.path, bytes, "application/json");
  assert.equal(
    await sha(await f.rt.get(target.kind, target.path)),
    asset.sha256,
  );
  await f.call("lab_restore_file", {
    w: f.w,
    a: f.a,
    session: session.id,
    old_asset: asset.id,
    verified_hash: asset.sha256,
  });
}
await f.call("lab_restore_finish", { w: f.w, a: f.a, session: session.id });
const restored = await f.db.query(
  "select active,settings from lab.workspaces where id=$1",
  [session.target_workspace_id],
);
assert.equal((restored.rows[0] as any).active, false);
assert.equal((restored.rows[0] as any).settings.api_enabled, false);
const count = await f.db.query(
  "select count(*)::integer n from lab.plans where workspace_id=$1 and status<>'paused'",
  [session.target_workspace_id],
);
assert.equal((count.rows[0] as any).n, 0);
console.log(
  "PASS 36 jobs / 72 raw files, stage blinding, global concurrency, shared results, blind review, raw-before-parse, no-call reparse, unknown lease and complete DB+raw inactive restore",
);
await f.db.close();
