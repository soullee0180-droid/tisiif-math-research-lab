import { it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  wire,
  cost,
  termination,
} from "../../supabase/functions/_shared/providers";
import { inspectPrepared } from "../../supabase/functions/_shared/pdf-inspection";
import {
  assemble,
  executionBundle,
  mock,
  stable,
} from "../../packages/contracts/core";
import {
  assembleResearch,
  researchSchemas,
  researchPrompts,
} from "../../packages/contracts/research";
import { summarize } from "../../packages/metrics";
import {
  paperInterval,
  researchMetrics,
  CALCULATION_VERSION,
} from "../../packages/metrics/research";
const prices = {
  pricing: {
    input_per_million: 4,
    output_per_million: 20,
    cache_read_per_million: 1,
    cache_write_5m_per_million: 5,
    cache_write_1h_per_million: 8,
  },
};
it("counts Google thoughts and cached tokens without double counting", () => {
  expect(
    cost(
      prices,
      {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 1000,
        totalTokenCount: 1150,
      },
      "google",
    ),
  ).toMatchObject({ total_tokens: 1150 });
  expect(
    cost(
      prices,
      {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 1000,
      },
      "google",
    ).cost_usd,
  ).toBeCloseTo(0.0214);
  expect(
    cost(
      prices,
      {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        cachedContentTokenCount: 80,
      },
      "google",
    ).cost_usd,
  ).toBeCloseTo(0.00116);
});
it("counts Anthropic cache creation/read and OpenAI reasoning correctly", () => {
  expect(
    cost(
      prices,
      {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
        cache_creation: {
          ephemeral_5m_input_tokens: 10,
          ephemeral_1h_input_tokens: 10,
        },
      },
      "anthropic",
    ),
  ).toMatchObject({ total_tokens: 250 });
  expect(
    cost(
      prices,
      {
        input_tokens: 100,
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 30 },
        input_tokens_details: { cached_tokens: 80 },
      },
      "openai",
    ).total_tokens,
  ).toBe(150);
  expect(
    cost(
      { pricing: { input_per_million: 4, output_per_million: 20 } },
      {
        input_tokens: 100,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 80 },
      },
      "openai",
    ).cost_usd,
  ).toBeNull();
});
it("protects core parameters even with attacker-supplied capability allowlists", async () => {
  const a = await assemble("r", "generate", "openai", 1, {
    input_mode: "text",
    goal: "g",
    obstacle: "o",
    public_text: "p",
  });
  for (const [provider, family, parameters] of [
    ["openai", "responses", { model: "evil" }],
    ["anthropic", "messages", { max_tokens: 1000000 }],
    ["google", "generate_content", { responseFormat: {} }],
  ] as const)
    expect(() =>
      wire(
        provider,
        {
          api_family: family,
          model_id: "fixed",
          output_cap: 1024,
          parameters,
          capabilities: { allowed_parameters: Object.keys(parameters) },
        },
        a,
      ),
    ).toThrow("UNVALIDATED");
  expect(() =>
    wire(
      "google",
      {
        api_family: "generate_content",
        parameters: { thinkingConfig: { tools: ["web"] } },
      },
      a,
    ),
  ).toThrow();
});
it("rejects truncated, refused, missing termination evidence", () => {
  expect(termination("anthropic", { stop_reason: "max_tokens" }).complete).toBe(
    false,
  );
  expect(
    termination("openai", {
      status: "completed",
      output: [{ content: [{ type: "refusal" }] }],
    }).refused,
  ).toBe(true);
  expect(
    termination("google", { candidates: [{ finishReason: "STOP" }] }).complete,
  ).toBe(true);
  expect(termination("google", {}).complete).toBe(false);
});
it("uses frozen base prompts and schemas", async () => {
  const b = executionBundle();
  b.prompts.generate.system = "FROZEN_SYSTEM";
  const a = await assemble(
    "r",
    "generate",
    "openai",
    1,
    { input_mode: "text" },
    [],
    {},
    {},
    b,
  );
  expect(a.system).toBe("FROZEN_SYSTEM");
  expect(a.execution_version).toBe(b.version);
});
it("does not pool incomplete pairs from different plans", () => {
  const r = {
    k: 1,
    selected: "I1",
    ideas: [{ id: "I1", u: [3], match: ["core"] }],
    selected_providers: ["openai", "google"],
    paper_id: "p",
    checkpoint_id: "c",
    revision_id: "v",
    repeat_index: 1,
    condition_hash: "same",
    cohort: "main",
    transport: "api",
  };
  const result = summarize([
    { ...r, generator: "google", plan_id: "a" },
    { ...r, generator: "openai", plan_id: "b" },
  ]);
  expect(result[0].metrics.selected_usefulness.google.eligible_runs).toBe(0);
});
it("swaps discrimination order with no hidden reference leakage", async () => {
  const c = {
    plan: {
      id: "p",
      protocol: {
        research_bundle: {
          version: "v",
          schemas: researchSchemas,
          prompts: researchPrompts,
        },
      },
    },
    revision: {
      task_type: "discrimination",
      input_mode: "text",
      public_text: "public",
      decision_point: "P1",
      research: {
        original: "good",
        flawed: "bad",
        answer_reason: "SECRET",
        rubric: [{ description: "HIDDEN" }],
        evidence: [{ critique: "PRIVATE" }],
      },
    },
    run: { revision_id: "v", repeat_index: 1, variant: "standard" },
  };
  const first = await assembleResearch(c),
    second = await assembleResearch({
      ...c,
      run: { ...c.run, variant: "swapped" },
    });
  expect(first.dto.options.A).toBe(second.dto.options.B);
  expect(first.mapping?.correct).not.toBe(second.mapping?.correct);
  for (const token of ["SECRET", "HIDDEN", "PRIVATE"])
    expect(first.prompt).not.toContain(token);
});
it("bootstrap is deterministic and undefined for one paper", () => {
  expect(paperInterval([0, 1, 2])).toEqual(paperInterval([0, 1, 2]));
  expect(paperInterval([1])).toBeNull();
});
it("uses two first independent reviews and preserves their scores after corrections", () => {
  const r = {
    id: "r",
    task_type: "generation",
    plan_id: "p",
    revision_id: "v",
    paper_id: "paper",
    checkpoint_id: "c",
    generator: "google",
    research_response: { body: {} },
  };
  const data = {
    runs: [r],
    inputs: [
      {
        plan_id: "p",
        revision_id: "v",
        snapshot: { research: { rubric: [{ id: "R1", max_points: 2 }] } },
      },
    ],
    research_reviews: [
      {
        run_id: "r",
        phase: "independent",
        version_no: 1,
        reviewer_code: "A",
        body: { scores: { R1: 0 } },
      },
      {
        run_id: "r",
        phase: "independent",
        version_no: 1,
        reviewer_code: "B",
        body: { scores: { R1: 2 } },
      },
      {
        run_id: "r",
        phase: "independent",
        version_no: 2,
        reviewer_code: "A",
        body: { scores: { R1: 2 } },
      },
    ],
  };
  const scored = researchMetrics(data);
  expect(scored.rows[0].metrics.rubric_fulfillment).toBe(0.5);
  const external = {
    external_share: true,
    inputs: [],
    research_reviews: [],
    runs: scored.rows.map((row) => ({
      ...row,
      exported_metrics: {
        calculation_version: CALCULATION_VERSION,
        metrics: row.metrics,
        scoring_source: row.scoring_source,
      },
    })),
  };
  expect(researchMetrics(external).groups).toEqual(scored.groups);
});
it("server validates raster PDF and rejects hidden text", async () => {
  const doc = await PDFDocument.create();
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  const image = await doc.embedPng(png);
  doc
    .addPage([100, 100])
    .drawImage(image, { x: 0, y: 0, width: 100, height: 100 });
  expect(
    (await inspectPrepared(await doc.save({ useObjectStreams: false }))).status,
  ).toBe("PASS");
  const text = await PDFDocument.create();
  text.addPage().drawText("SECRET CANARY");
  await expect(inspectPrepared(await text.save())).rejects.toThrow(
    "PDF_HIDDEN_CONTENT",
  );
});

it("exports distinct blind reviewer files and imports editable scores for both task families", async () => {
  const { reviewWorkbook, readReviewWorkbook } = await import(
    "../../apps/web/src/review-workbook"
  );
  const { default: ExcelJS } = await import("exceljs");
  const data = {
    runs: [
      {
        id: "r",
        plan_id: "p",
        revision_id: "v",
        task_type: "idea",
        generator: "SECRET_MODEL",
        ideas: [{ candidate_id: "I1", title: "idea", idea_md: "body", u: [4] }],
      },
    ],
    inputs: [
      {
        plan_id: "p",
        revision_id: "v",
        input_hash: "h",
        snapshot: {
          input_mode: "text",
          public_text: "public",
          reference_idea_md: "reference",
        },
      },
    ],
  };
  const bytes = await reviewWorkbook(data, "ReviewerA"),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as any);
  const s = book.getWorksheet("독립채점")!;
  expect(JSON.stringify(s.getRow(2).values)).not.toContain("SECRET_MODEL");
  s.getCell("H2").value = '{"I1":3}';
  s.getCell("I2").value = "Independent reasoning";
  s.getCell("N2").value = '{"I1":"partial"}';
  const file = new File(
    [(await book.xlsx.writeBuffer()) as BlobPart],
    "review.xlsx",
  );
  const parsed = await readReviewWorkbook(file, data);
  expect(parsed.reviewer_code).toBe("ReviewerA");
  expect(parsed.rows[0]).toMatchObject({
    scores: { I1: 3 },
    candidate_labels: { I1: "partial" },
  });
});

it("dispatch records HTTP failures and still dispatches other providers", async () => {
  const { dispatch } = await import(
    "../../supabase/functions/_shared/dispatch"
  );
  const calls: string[] = [],
    events: any[] = [];
  const rt: any = {
    env: (key: string) =>
      key === "SUPABASE_URL"
        ? "https://fixture.invalid"
        : "fixture-scheduler-secret-at-least-32-characters",
    rpc: async (name: string, p: any) => {
      if (name === "lab_claim") return { attempt_id: p.provider_name };
      if (name === "lab_dispatch_event") events.push(p);
      return true;
    },
    fetch: async (_url: string, p: any) => {
      calls.push(JSON.parse(p.body).attempt_id);
      return Response.json({}, { status: calls.length === 1 ? 500 : 200 });
    },
  };
  const result = await dispatch(rt);
  expect(result.ok).toBe(false);
  expect(calls).toEqual(["google", "openai", "anthropic"]);
  expect(events).toHaveLength(1);
  expect(result.results[2].status).toBe("accepted");
});
