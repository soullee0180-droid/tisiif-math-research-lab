import { paperInterval } from "./research";
import { stable, sha, type Json, experimentProviders } from "../contracts/core";
export const metricNames = [
  "selected_usefulness",
  "best_usefulness",
  "selection_regret",
  "any_core_match",
  "selected_core_match",
] as const;
export function runMetrics(run: Json) {
  const ideas = run.ideas || [],
    expected = experimentProviders(run).length - 1;
  const numeric = (i: Json) =>
    expected > 0 &&
    i.u?.length === expected &&
    i.u.every((v: any) => typeof v === "number" && Number.isFinite(v));
  const means = ideas.map((i: Json) =>
    numeric(i)
      ? i.u.reduce((a: number, b: number) => a + b, 0) / expected
      : null,
  );
  const core = (i: Json) =>
    expected > 0 &&
    i.match?.length === expected &&
    i.match.every((v: any) => ["none", "partial", "core"].includes(v))
      ? i.match.every((v: any) => v === "core")
        ? 1
        : 0
      : null;
  const selected = ideas.findIndex(
      (i: Json) => (i.candidate_id || i.id) === run.selected,
    ),
    su = selected >= 0 ? means[selected] : null;
  const best =
      ideas.length === run.k && means.every((v: any) => v !== null)
        ? Math.max(...means)
        : null,
    cores = ideas.map(core);
  return {
    selected_usefulness: su,
    best_usefulness: best,
    selection_regret: best !== null && su !== null ? best - su : null,
    any_core_match:
      ideas.length === run.k && cores.every((v: any) => v !== null)
        ? cores.includes(1)
          ? 1
          : 0
        : null,
    selected_core_match: selected >= 0 ? cores[selected] : null,
    review_flags: ideas
      .filter(
        (i: Json) =>
          expected === 2 && numeric(i) && Math.abs(i.u[0] - i.u[1]) >= 2,
      )
      .map((i: Json) => i.candidate_id || i.id),
  };
}
const mean = (a: number[]) =>
  a.length ? a.reduce((a, b) => a + b, 0) / a.length : null;
export function summarize(runs: Json[]) {
  const groups = new Map<string, Json[]>();
  for (const r of runs) {
    if (r.human_corrected || (r.task_type && r.task_type !== "idea")) continue;
    const key = stable({
      cohort: r.cohort,
      transport: r.transport,
      input_mode: r.input_mode,
      condition_hash: r.condition_hash,
      selected_providers: experimentProviders(r),
      reveal_generator_identity: r.reveal_generator_identity === true,
    });
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return [...groups].map(([condition, rows]) => ({
    condition,
    providers: experimentProviders(rows[0]),
    metrics: Object.fromEntries(
      metricNames.map((metric) => {
        const eligible = rows.filter((r) => runMetrics(r)[metric] !== null);
        const pairs = new Map<string, Set<string>>();
        for (const r of eligible) {
          const key =
            (r.plan_id || "legacy") +
            ":" +
            r.revision_id +
            ":" +
            r.repeat_index;
          pairs.set(key, new Set([...(pairs.get(key) || []), r.generator]));
        }
        const common = eligible.filter(
          (r) =>
            pairs.get(
              (r.plan_id || "legacy") +
                ":" +
                r.revision_id +
                ":" +
                r.repeat_index,
            )?.size === experimentProviders(rows[0]).length,
        );
        return [
          metric,
          Object.fromEntries(
            experimentProviders(rows[0]).map((provider) => {
              const chosen = common.filter((r) => r.generator === provider);
              const papers = new Map<string, Map<string, number[]>>();
              for (const r of chosen) {
                if (!papers.has(r.paper_id)) papers.set(r.paper_id, new Map());
                const checkpoints = papers.get(r.paper_id)!;
                checkpoints.set(r.checkpoint_id, [
                  ...(checkpoints.get(r.checkpoint_id) || []),
                  runMetrics(r)[metric] as number,
                ]);
              }
              const perPaper = [...papers.values()].map(
                (cs) => mean([...cs.values()].map((xs) => mean(xs)!))!,
              );
              return [
                provider,
                {
                  value: mean(perPaper),
                  interval: paperInterval(perPaper),
                  per_paper: [...papers.keys()].map((paper_id, i) => ({
                    paper_id,
                    value: perPaper[i],
                  })),
                  eligible_runs: chosen.length,
                  total_runs: rows.filter((r) => r.generator === provider)
                    .length,
                  papers: papers.size,
                  checkpoints: new Set(chosen.map((r) => r.checkpoint_id)).size,
                  common_pairs: new Set(
                    common.map(
                      (r) =>
                        (r.plan_id || "legacy") +
                        ":" +
                        r.revision_id +
                        ":" +
                        r.repeat_index,
                    ),
                  ).size,
                  missing:
                    rows.filter((r) => r.generator === provider).length -
                    chosen.length,
                },
              ];
            }),
          ),
        ];
      }),
    ),
  }));
}
export function reliability(pairs: Json[]) {
  const valid = pairs.filter((p) => p.a && p.b);
  const numeric = valid.filter(
    (p) =>
      Number.isFinite(p.a.score) &&
      p.a.score !== null &&
      Number.isFinite(p.b.score) &&
      p.b.score !== null,
  );
  const labels = valid.filter(
    (p) =>
      p.a.label &&
      p.b.label &&
      p.a.label !== "undetermined" &&
      p.b.label !== "undetermined",
  );
  return {
    paired: valid.length,
    score_n: numeric.length,
    score_mae: mean(numeric.map((p) => Math.abs(p.a.score - p.b.score))),
    score_exact: mean(numeric.map((p) => +(p.a.score === p.b.score))),
    label_n: labels.length,
    label_agreement: mean(labels.map((p) => +(p.a.label === p.b.label))),
  };
}
