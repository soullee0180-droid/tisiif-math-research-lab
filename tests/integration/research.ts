import assert from "node:assert/strict";
import { fixture } from "./fixture";
import { execute } from "../../supabase/functions/_shared/execution";
const f = await fixture();
const paper = await f.write("paper_create", { title: "ML fixture" }),
  ids: string[] = [];
for (const task_type of [
  "generation",
  "discrimination",
  "anchoring",
  "review",
]) {
  const cp = await f.write("checkpoint_create", {
    paper_id: paper.id,
    title: task_type,
    body: {
      task_type,
      decision_point: "P1",
      input_mode: "text",
      goal: "g",
      obstacle: "o",
      public_text: "PUBLIC",
      reference_idea_md: "SECRET_REFERENCE",
      research: {
        original: "VALID",
        flawed: "FLAWED",
        control: "CONTROL",
        answer_reason: "SECRET_REASON",
        rubric: [{ id: "R1", description: "SECRET_RUBRIC", max_points: 2 }],
        evidence: [
          {
            id: "E1",
            status: "confirmed",
            critique: "SECRET_CRITIQUE",
            review_location: "Review 1",
          },
        ],
      },
    },
  });
  await f.write("revision_approve", {
    id: cp.id,
    if_match: 1,
    checks: [true, true, true],
  });
  ids.push(cp.id);
}
const plan = await f.write("plan_create", {
  name: "Research test",
  k: 1,
  repeats: 1,
  cohort: "fixture",
  transport: "mock",
  selected_providers: ["anthropic"],
  revision_ids: ids,
});
await f.write("plan_control", { id: plan.id, status: "running" });
for (let i = 0; i < 10; i++) {
  const c = await f.call("lab_claim", { provider_name: "anthropic" });
  if (c) await execute(f.rt, c.attempt_id);
}
const details = await f.call("lab_read", {
  w: f.w,
  a: f.a,
  kind: "plan",
  args: { id: plan.id },
});
assert.equal(details.status, "complete");
assert.equal(details.runs.length, 6);
for (const r of details.runs)
  for (const j of r.jobs) {
    assert.equal(j.stage, "research");
    const p = j.attempts[0].request_snapshot.prompt;
    for (const secret of [
      "SECRET_REFERENCE",
      "SECRET_REASON",
      "SECRET_RUBRIC",
      "SECRET_CRITIQUE",
    ])
      assert.ok(!p.includes(secret));
  }
let result = await f.call("lab_read", {
  w: f.w,
  a: f.a,
  kind: "results",
  args: { plan_ids: [plan.id] },
});
assert.equal(result.runs.filter((r: any) => r.research_response).length, 6);
const run = result.runs.find((r: any) => r.task_type === "generation");
const submit = (code: string, phase = "independent", score = 1, reason = "") =>
  f.call("lab_research_review_import", {
    w: f.w,
    a: f.a,
    p: {
      reviewer_code: code,
      phase,
      rows: [
        {
          run_id: run.id,
          scores: { R1: score },
          rationale: "Independent written rationale",
          correction_reason: reason,
        },
      ],
    },
    idem: crypto.randomUUID(),
  });
await assert.rejects(submit("consensus", "consensus"), /TWO_INDEPENDENT/);
await submit("ReviewerA");
await submit("ReviewerB");
await assert.rejects(submit("ReviewerA"), /CORRECTION_REASON/);
await submit(
  "ReviewerA",
  "independent",
  2,
  "Documented correction after first rating",
);
await submit("team_consensus", "consensus", 2);
result = await f.call("lab_read", {
  w: f.w,
  a: f.a,
  kind: "results",
  args: { plan_ids: [plan.id] },
});
assert.equal(result.research_reviews.length, 4);
const other = await f.write("plan_create", {
  name: "Other",
  k: 1,
  repeats: 1,
  cohort: "fixture",
  transport: "mock",
  selected_providers: ["anthropic"],
  revision_ids: [ids[0]],
});
assert.equal(
  (
    await f.call("lab_read", {
      w: f.w,
      a: f.a,
      kind: "results",
      args: { plan_ids: [other.id] },
    })
  ).research_reviews.length,
  0,
);
const snap = await f.write("analysis_create", { plan_ids: [plan.id] });
assert.equal(
  snap.sha256,
  (
    await f.call("lab_read", {
      w: f.w,
      a: f.a,
      kind: "analysis",
      args: { id: snap.id },
    })
  ).sha256,
);
console.log(
  "PASS all four ML tasks, paired order/control variants, hidden-evidence boundaries, independent first/corrected/consensus reviews, analysis scoping and snapshot hash",
);
const legacyRevision = await f.revision();
const legacyPlan = await f.write("plan_create", {
  name: "Legacy independent review",
  k: 1,
  repeats: 1,
  cohort: "fixture",
  transport: "mock",
  selected_providers: ["anthropic"],
  revision_ids: [legacyRevision],
});
await f.write("plan_control", { id: legacyPlan.id, status: "running" });
for (let i = 0; i < 6; i++) {
  const claim = await f.call("lab_claim", { provider_name: "anthropic" });
  if (claim) await execute(f.rt, claim.attempt_id);
}
const legacyResults = await f.call("lab_read", {
  w: f.w,
  a: f.a,
  kind: "results",
  args: { plan_ids: [legacyPlan.id] },
});
const legacyRun = legacyResults.runs[0];
assert.equal(legacyRun.ideas.length, 1);
await f.call("lab_research_review_import", {
  w: f.w,
  a: f.a,
  p: {
    reviewer_code: "LegacyReviewer",
    phase: "independent",
    rows: [
      {
        run_id: legacyRun.id,
        scores: { I1: 3 },
        candidate_labels: { I1: "core" },
        rationale: "Legacy candidate reviewed independently",
      },
    ],
  },
  idem: crypto.randomUUID(),
});
console.log("PASS legacy idea independent review import");
await f.db.close();
