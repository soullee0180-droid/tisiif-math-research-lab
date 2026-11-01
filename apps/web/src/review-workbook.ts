import ExcelJS from "exceljs";
import {
  type Json,
  stable,
  sha,
  publicContext,
} from "../../../packages/contracts/core";
import { safeCell } from "./workbook";
export async function reviewWorkbook(
  data: Json,
  reviewer: string,
  phase = "independent",
) {
  if (reviewer.trim().length < 2)
    throw Error("검토자 고유 코드를 2자 이상 입력하세요.");
  const book = new ExcelJS.Workbook();
  const info = book.addWorksheet("안내");
  info.addRows([
    ["형식", "tisiif-independent-review-v1"],
    ["검토자", reviewer],
    ["단계", phase],

    [
      "유의",
      "각 검토자는 다른 사람의 점수를 보지 않고 별도 파일을 작성하세요. 공개 계정은 검토자 신원을 인증하지 않습니다.",
    ],
    [
      "입력",
      "scores_json의 각 기준 점수, rationale, 해당 과제의 판정 칸을 채우세요. 최초 점수는 보존됩니다.",
    ],
    [
      "앵커 판정",
      "corrected / followed / flagged_only / valid_preserved / other",
    ],
    [
      "심사 판정",
      "matched_evidence_ids_json에는 근거 ID 배열, false_positive_count에는 오지적 개수를 입력하세요.",
    ],
  ]);
  const long = book.addWorksheet("긴텍스트");
  long.addRow(["문단ID", "순번", "텍스트"]);
  let longId = 0;
  const preserve = (value: any) => {
    if (typeof value !== "string" || value.length <= 30000)
      return safeCell(value);
    const id = "T" + ++longId;
    for (let at = 0; at < value.length; at += 30000)
      long.addRow([id, at / 30000 + 1, safeCell(value.slice(at, at + 30000))]);
    return "[긴텍스트 시트: " + id + "]";
  };
  const sheet = book.addWorksheet("독립채점");
  sheet.addRow([
    "run_id",
    "input_hash",
    "task_type",
    "decision_point",
    "public_input",
    "model_answer",
    "rubric_and_reference",
    "scores_json",
    "rationale",
    "anchor_outcome",
    "matched_evidence_ids_json",
    "false_positive_count",
    "correction_reason",
    "candidate_labels_json",
  ]);
  const eligible = (data.runs || []).filter(
    (r: Json) => r.research_response || r.ideas?.length,
  );
  // Stable blind order independent of model identity; no prior ratings included.
  const ordered = await Promise.all(
    eligible.map(async (r: Json) => ({
      r,
      h: await sha(r.id + ":" + reviewer),
    })),
  );
  ordered.sort((a, b) => a.h.localeCompare(b.h));
  for (const { r } of ordered) {
    const input = data.inputs.find(
      (i: Json) => i.plan_id === r.plan_id && i.revision_id === r.revision_id,
    );
    const rev = input.snapshot,
      x = rev.research || {};
    const legacy = !r.task_type || r.task_type === "idea";
    const rubric = legacy
      ? r.ideas.map((i: Json) => ({
          id: i.candidate_id,
          description:
            "이 후보의 유용성 (0–4). 일치도는 candidate_labels_json에 별도 기입.",
          max_points: 4,
        }))
      : x.rubric;
    const publicInput = {
      ...publicContext(rev),
      ...(r.task_type === "anchoring"
        ? { preceding_step: r.variant === "control" ? x.control : x.flawed }
        : {}),
      ...(r.task_type === "discrimination"
        ? {
            A:
              r.research_response.mapping.correct === "A"
                ? x.original
                : x.flawed,
            B:
              r.research_response.mapping.correct === "B"
                ? x.original
                : x.flawed,
          }
        : {}),
    };
    sheet.addRow(
      [
        r.id,
        input.input_hash,
        r.task_type || "idea",
        r.decision_point,
        stable(publicInput),
        stable(
          legacy
            ? r.ideas.map((i: Json) => ({
                candidate_id: i.candidate_id,
                title: i.title,
                idea_md: i.idea_md,
              }))
            : r.research_response.body,
        ),
        stable({
          rubric,
          answer_reason: x.answer_reason,
          evidence: x.evidence,
          reference: rev.reference_idea_md,
        }),
        stable(
          Object.fromEntries((rubric || []).map((c: Json) => [c.id, null])),
        ),
        "",
        "",
        "[]",
        "",
        "",
        stable(
          legacy
            ? Object.fromEntries(r.ideas.map((i: Json) => [i.candidate_id, ""]))
            : {},
        ),
      ].map(preserve),
    );
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((c) => (c.width = 30));
  return new Uint8Array(await book.xlsx.writeBuffer());
}
export async function readReviewWorkbook(file: File, data: Json) {
  if (file.size > 20 * 1024 * 1024)
    throw Error("채점 파일은 20MiB 이하만 가능합니다.");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const info = book.getWorksheet("안내"),
    sheet = book.getWorksheet("독립채점");
  if (info?.getCell("B1").value !== "tisiif-independent-review-v1" || !sheet)
    throw Error("REVIEW_FILE_FORMAT");
  const text = (v: any) => {
    if (v && typeof v === "object") throw Error("REVIEW_FORMULAS_NOT_ALLOWED");
    return String(v ?? "").replace(/^'(?=[=+@-])/, "");
  };
  const rows: Json[] = [];
  for (let n = 2; n <= sheet.rowCount; n++) {
    const vals = Array.from({ length: 14 }, (_, i) =>
      text(sheet.getRow(n).getCell(i + 1).value),
    );
    if (!vals[0]) continue;
    const r = data.runs.find((r: Json) => r.id === vals[0]);
    const input = data.inputs.find(
      (i: Json) => i.plan_id === r?.plan_id && i.revision_id === r?.revision_id,
    );
    if (!r || input?.input_hash !== vals[1])
      throw Error("REVIEW_SNAPSHOT_MISMATCH");
    const scores = JSON.parse(vals[7]);
    if (!scores || Object.values(scores).some((x) => !Number.isInteger(x)))
      throw Error("채점하지 않은 기준이 있습니다.");
    rows.push({
      run_id: r.id,
      scores,
      rationale: vals[8],
      anchor_outcome: vals[9],
      matched_evidence_ids: JSON.parse(vals[10] || "[]"),
      false_positive_count: vals[11] === "" ? null : Number(vals[11]),
      correction_reason: vals[12],
      candidate_labels: JSON.parse(vals[13] || "{}"),
    });
  }
  return {
    reviewer_code: text(info!.getCell("B2").value),
    phase: text(info!.getCell("B3").value),
    rows,
  };
}
