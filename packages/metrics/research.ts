import { type Json, stable } from "../contracts/core";
export const CALCULATION_VERSION = "metrics-v5";
const mean = (a: number[]) =>
  a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
// Resample papers (not correlated runs). Deterministic percentile bootstrap for reproducible exports.
export function paperInterval(values: number[], seed = 20261029) {
  if (values.length < 2) return null;
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const draws = Array.from(
    { length: 2000 },
    () => mean(values.map(() => values[Math.floor(random() * values.length)]))!,
  ).sort((a, b) => a - b);
  return {
    low: draws[49],
    high: draws[1949],
    method: "paper-bootstrap-percentile-95",
    replicates: 2000,
    papers: values.length,
  };
}
export function researchMetrics(data: Json) {
  const rows: Json[] = [];
  for (const run of data.runs || []) {
    if (!run.task_type || run.task_type === "idea" || run.human_corrected)
      continue;
    if (
      data.external_share &&
      run.exported_metrics?.calculation_version === CALCULATION_VERSION
    ) {
      rows.push({
        ...run,
        metrics: run.exported_metrics.metrics,
        scoring_source: run.exported_metrics.scoring_source,
      });
      continue;
    }
    const input =
        data.inputs.find(
          (i: Json) =>
            i.plan_id === run.plan_id && i.revision_id === run.revision_id,
        )?.snapshot || {},
      response = run.research_response;
    const all = (data.research_reviews || []).filter(
      (r: Json) => r.run_id === run.id,
    );
    const consensus = all
      .filter((r: Json) => r.phase === "consensus")
      .sort(
        (a: Json, b: Json) =>
          Date.parse(b.created_at) - Date.parse(a.created_at),
      )[0];
    const first = all.filter(
      (r: Json) => r.phase === "independent" && r.version_no === 1,
    );
    const ratings = consensus ? [consensus] : first.length >= 2 ? first : [];
    const rubric = input.research?.rubric || [];
    const max = rubric.reduce((s: number, r: Json) => s + r.max_points, 0);
    const completion =
      ratings.length && max
        ? mean(
            ratings.map(
              (r: Json) =>
                rubric.reduce(
                  (s: number, c: Json) => s + Number(r.body.scores[c.id]),
                  0,
                ) / max,
            ),
          )
        : null;
    const metric: Json = { rubric_fulfillment: completion };
    if (run.task_type === "discrimination")
      metric.discrimination_accuracy = response?.mapping
        ? +(response.body.choice === response.mapping.correct)
        : (response?.discrimination_correct ?? null);
    if (run.task_type === "anchoring") {
      const outcomes = ratings.map((r: Json) => r.body.anchor_outcome);
      const agrees = outcomes.length && new Set(outcomes).size === 1;
      metric[
        run.variant === "control"
          ? "valid_step_preservation"
          : "anchor_correction"
      ] = agrees
        ? +(
            outcomes[0] ===
            (run.variant === "control" ? "valid_preserved" : "corrected")
          )
        : null;
    }
    if (run.task_type === "review") {
      const targets = (input.research?.evidence || [])
        .filter((e: Json) => e.status === "confirmed")
        .map((e: Json) => e.id);
      metric.confirmed_critique_recall =
        ratings.length && targets.length
          ? mean(
              ratings.map(
                (r: Json) =>
                  targets.filter((id: string) =>
                    (r.body.matched_evidence_ids || []).includes(id),
                  ).length / targets.length,
              ),
            )
          : null;
      const n = response?.body.critiques?.length;
      metric.false_positive_fraction =
        ratings.length && n > 0
          ? mean(ratings.map((r: Json) => r.body.false_positive_count / n))
          : null;
    }
    rows.push({
      ...run,
      metrics: metric,
      scoring_source: consensus
        ? "consensus"
        : first.length >= 2
          ? "independent_first_mean"
          : "not_double_scored",
    });
  }
  const groups = new Map<string, Json[]>();
  for (const row of rows) {
    const key = stable({
      task_type: row.task_type,
      decision_point: row.decision_point,
      variant: row.variant,
      condition_hash: row.condition_hash,
      transport: row.transport,
      cohort: row.cohort,
      generator: row.generator,
    });
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return {
    rows,
    groups: [...groups].map(([condition, rs]) => ({
      condition,
      metrics: Object.fromEntries(
        [...new Set(rs.flatMap((r) => Object.keys(r.metrics)))].map((key) => {
          const ps = new Map<string, Map<string, number[]>>();
          for (const r of rs) {
            const value = r.metrics[key];
            if (value === null || value === undefined) continue;
            if (!ps.has(r.paper_id)) ps.set(r.paper_id, new Map());
            const cs = ps.get(r.paper_id)!;
            cs.set(r.checkpoint_id, [
              ...(cs.get(r.checkpoint_id) || []),
              value,
            ]);
          }
          const papers = [...ps].map(([id, cs]) => ({
            paper_id: id,
            value: mean([...cs.values()].map((v) => mean(v)!))!,
          }));
          return [
            key,
            {
              value: mean(papers.map((p) => p.value)),
              interval: paperInterval(papers.map((p) => p.value)),
              per_paper: papers,
              eligible: rs.filter(
                (r) => r.metrics[key] !== null && r.metrics[key] !== undefined,
              ).length,
              total: rs.length,
            },
          ];
        }),
      ),
    })),
    paired_discrimination: pairDiscrimination(rows),
  };
}
function pairDiscrimination(rows: Json[]) {
  const groups = new Map<string, Json[]>();
  for (const r of rows.filter((r) => r.task_type === "discrimination")) {
    const key = [r.plan_id, r.revision_id, r.repeat_index, r.generator].join(
      ":",
    );
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return [...groups].map(([block, rs]) => ({
    block,
    both_orders_correct:
      rs.length === 2 &&
      rs.every((r) => r.metrics.discrimination_accuracy !== null)
        ? +rs.every((r) => r.metrics.discrimination_accuracy === 1)
        : null,
  }));
}
export function failureCounts(jobs: Json[]) {
  const counts: Record<string, number> = {};
  for (const j of jobs)
    if (j.status !== "complete") {
      const key = j.status + ":" + (j.last_error || "not_finished");
      counts[key] = (counts[key] || 0) + 1;
    }
  return counts;
}
