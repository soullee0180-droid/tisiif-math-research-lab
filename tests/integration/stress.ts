import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixture } from "./fixture";
import { execute } from "../../supabase/functions/_shared/execution";
import { providers } from "../../packages/contracts/core";
const f = await fixture(),
  start = Date.now();
const revisions = [];
for (let i = 0; i < 40; i++) revisions.push(await f.revision(i));
const plans = [];
for (let p = 0; p < 2; p++) {
  const owner = p ? f.b : f.a;
  const plan = await f.write(
    "plan_create",
    {
      name: "Synthetic stress " + p,
      k: 1,
      repeats: 5,
      cohort: "fixture",
      transport: "mock",
      revision_ids: revisions,
    },
    owner,
  );
  plans.push(plan.id);
  await f.write("plan_control", { id: plan.id, status: "running" }, owner);
}
// 40 revisions x 3 generators x 5 repeats x 6 stages x 2 owners = 7,200 logical jobs.
const counts: Record<string, number> = {};
let n = 0;
while (n < 7200) {
  let claimed = 0;
  for (const provider of providers) {
    const job = await f.call("lab_claim", { provider_name: provider });
    if (!job) continue;
    const c = await f.call("lab_context", { attempt: job.attempt_id });
    counts[c.plan.id] = (counts[c.plan.id] || 0) + 1;
    if (n < 30)
      assert.ok(
        Math.abs((counts[plans[0]] || 0) - (counts[plans[1]] || 0)) <= 3,
        "early round-robin fairness",
      );
    await execute(f.rt, job.attempt_id);
    n++;
    claimed++;
    if (n % 600 === 0) {
      console.log(n + "/7200");
      await f.db.exec("checkpoint");
    }
  }
  if (!claimed) throw Error("STRESS_QUEUE_STALLED");
}
const jobs = await f.db.query(
  "select status,count(*)::integer n from lab.jobs group by status",
);
assert.deepEqual(jobs.rows, [{ status: "complete", n: 7200 }]);
assert.equal(f.objects.size, 14400);
assert.equal(f.networkCalls(), 0);
assert.equal(counts[plans[0]], 3600);
assert.equal(counts[plans[1]], 3600);
const report = {
  status: "PASS",
  environment: "local embedded PostgreSQL (PGlite)",
  actual_cloud: false,
  logical_jobs: 7200,
  raw_objects: 14400,
  real_provider_calls: 0,
  owners: 2,
  completed_by_plan: counts,
  elapsed_ms: Date.now() - start,
  at: new Date().toISOString(),
};
await fs.mkdir("test-results", { recursive: true });
await fs.writeFile("test-results/stress.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
await f.db.close();
