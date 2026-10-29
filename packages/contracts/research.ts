import { type Json, sha, stable, publicContext, validateJson } from "./core.ts";
export const taskTypes = [
  "idea",
  "generation",
  "discrimination",
  "anchoring",
  "review",
] as const;
export const taskLabels: Record<string, string> = {
  idea: "기존 아이디어 생성·선택",
  generation: "실험 설계 생성",
  discrimination: "원본·결함 대안 판별",
  anchoring: "앞 단계 앵커링",
  review: "심사 검토",
};
export const decisionLabels: Record<string, string> = {
  P1: "비교 구조",
  P2: "조건",
  P3: "평가 지표",
  P4: "변동·통제",
  P5: "분석 계획",
};
const string = { type: "string" },
  object = (properties: Json) => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
export const researchSchemas: Json = {
  generation: object({
    design_md: string,
    rationale_md: string,
    risks: { type: "array", items: string },
  }),
  discrimination: object({
    choice: { type: "string", enum: ["A", "B"] },
    rationale_md: string,
  }),
  anchoring: object({
    detects_problem: { type: "boolean" },
    revised_design_md: string,
    rationale_md: string,
  }),
  review: object({
    critiques: {
      type: "array",
      items: object({
        claim: string,
        evidence_in_input: string,
        proposed_fix: string,
      }),
    },
  }),
};
export const researchPrompts: Json = {
  generation:
    "Propose an experiment design for the stated decision point. Explain your rationale and limitations. Do not invent results.",
  discrimination:
    "Choose the better experiment design, A or B, and justify your choice. Do not assume either position is correct.",
  anchoring:
    "Review the supplied preceding design step. Identify any methodological problem and provide a justified revised design. If it is valid, preserve it and explain why.",
  review:
    "Review the supplied experiment design. List concrete methodological concerns, evidence in the supplied input, and a proposed fix for each. Do not invent unseen reviewer comments.",
};
export function validateResearch(r: Json) {
  const type = r.task_type || "idea";
  if (!taskTypes.includes(type as any)) throw Error("TASK_TYPE_INVALID");
  if (type === "idea") return;
  if (!Object.hasOwn(decisionLabels, r.decision_point))
    throw Error("DECISION_POINT_REQUIRED");
  const x = r.research || {};
  if (
    !Array.isArray(x.rubric) ||
    !x.rubric.length ||
    x.rubric.some(
      (c: Json) =>
        !c.id ||
        !c.description ||
        !Number.isInteger(c.max_points) ||
        c.max_points < 1 ||
        c.max_points > 10,
    ) ||
    new Set(x.rubric.map((c: Json) => c.id)).size !== x.rubric.length
  )
    throw Error("RESEARCH_RUBRIC_REQUIRED");
  if (
    type === "discrimination" &&
    (!x.original?.trim() || !x.flawed?.trim() || !x.answer_reason?.trim())
  )
    throw Error("DISCRIMINATION_INPUT_REQUIRED");
  if (
    type === "anchoring" &&
    (!x.control?.trim() || !x.flawed?.trim() || !x.answer_reason?.trim())
  )
    throw Error("ANCHOR_CONDITIONS_REQUIRED");
  if (
    type === "review" &&
    (!Array.isArray(x.evidence) ||
      !x.evidence.length ||
      x.evidence.some(
        (e: Json) =>
          !e.id ||
          !e.review_location ||
          !e.critique ||
          !["confirmed", "partial", "raised"].includes(e.status),
      ))
  )
    throw Error("REVIEW_EVIDENCE_REQUIRED");
}
export async function assembleResearch(c: Json) {
  const r = c.revision,
    x = r.research || {},
    type = r.task_type,
    bundle = c.plan.protocol.research_bundle;
  if (!bundle?.schemas?.[type]) throw Error("RESEARCH_PROTOCOL_NOT_FROZEN");
  const dto: Json = {
    public_context: publicContext(r),
    decision_point: r.decision_point,
  };
  let mapping: Json | null = null;
  if (type === "discrimination") {
    const seed = await sha(
      c.plan.id + ":" + c.run.revision_id + ":" + c.run.repeat_index,
    );
    const originalFirst =
      (parseInt(seed.slice(0, 2), 16) % 2 === 0) !==
      (c.run.variant === "swapped");
    dto.options = {
      A: originalFirst ? x.original : x.flawed,
      B: originalFirst ? x.flawed : x.original,
    };
    mapping = {
      correct: originalFirst ? "A" : "B",
      seed,
      variant: c.run.variant,
    };
  }
  if (type === "anchoring")
    dto.preceding_step = c.run.variant === "control" ? x.control : x.flawed;
  return {
    system:
      "You are evaluating an experiment design. Use only the public input. Return exactly the required JSON; no tools or external search.",
    prompt:
      bundle.prompts[type] +
      "\n\n" +
      stable(dto) +
      (c.plan.protocol.stage_prompts?.generate
        ? "\n\nAdditional instructions: " +
          c.plan.protocol.stage_prompts.generate
        : ""),
    schema: bundle.schemas[type],
    dto,
    mapping,
    execution_version: bundle.version,
  };
}
export function parseResearch(type: string, raw: string, s: Json) {
  const result = JSON.parse(
    raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1"),
  );
  validateJson(result, s);
  return result;
}
export function mockResearch(type: string) {
  return type === "discrimination"
    ? { choice: "A", rationale_md: "Synthetic diagnostic only." }
    : type === "anchoring"
      ? {
          detects_problem: true,
          revised_design_md: "Synthetic design.",
          rationale_md: "Synthetic only.",
        }
      : type === "review"
        ? {
            critiques: [
              {
                claim: "Synthetic concern",
                evidence_in_input: "Synthetic text",
                proposed_fix: "Synthetic fix",
              },
            ],
          }
        : {
            design_md: "Synthetic design.",
            rationale_md: "Synthetic rationale.",
            risks: ["Fixture only."],
          };
}
