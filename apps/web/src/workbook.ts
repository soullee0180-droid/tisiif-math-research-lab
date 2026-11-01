import {
  researchMetrics,
  failureCounts,
  CALCULATION_VERSION,
} from "../../../packages/metrics/research";
import ExcelJS from "exceljs";
import { sha, enc, type Json, stable } from "../../../packages/contracts/core";
import { summarize, runMetrics, metricNames } from "../../../packages/metrics";
export const sheetNames = [
  "요약",
  "논문_분기점",
  "후보_아이디어",
  "모델_선택",
  "유용성_평가",
  "일치도_평가",
  "사람_검토",
  "오류_미완료",
  "실행_조건",
  "논문별_결과",
  "ML_과제",
  "ML_채점",
  "실패_집계",
  "긴텍스트_목록",
];
export function safeCell(v: any) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = typeof v === "string" ? v : stable(v);
  return /^[\s\u0000-\u001f]*[=+@-]/.test(s) ? "'" + s : s;
}
export async function workbook(data: Json, analysis: Json) {
  const book = new ExcelJS.Workbook();
  book.creator = "TISIIF";
  const sidecars: Record<string, Uint8Array> = {};
  const long: any[][] = [];
  let serial = 0;
  const cell = async (v: any, source: string) => {
    if (typeof v === "string" && v.length > 30000) {
      const path = "long-text/" + String(++serial).padStart(6, "0") + ".txt",
        bytes = enc.encode(v);
      sidecars[path] = bytes;
      long.push([source, path, await sha(bytes), v.length, bytes.length]);
      return "[전체 내용: " + path + "]";
    }
    return safeCell(v);
  };
  const sheet = async (name: string, headers: string[], rows: any[][]) => {
    const s = book.addWorksheet(name);
    s.addRow(headers);
    for (let i = 0; i < rows.length; i++) {
      const out = [];
      for (let j = 0; j < rows[i].length; j++)
        out.push(
          await cell(rows[i][j], name + ":" + (i + 2) + ":" + headers[j]),
        );
      s.addRow(out);
    }
    s.views = [{ state: "frozen", ySplit: 1 }];
    s.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, s.rowCount), column: headers.length },
    };
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2454B8" },
    };
    s.columns.forEach((col, i) => {
      col.width = i === 0 ? 38 : 24;
    });
    return s;
  };
  const summary: any[][] = [];
  for (const group of summarize(data.runs || []))
    for (const metric of metricNames)
      for (const [provider, m] of Object.entries(group.metrics[metric]) as [
        string,
        any,
      ][])
        summary.push([
          analysis.id,
          analysis.sha256,
          group.condition,
          metric,
          provider,
          m.value,
          m.eligible_runs,
          m.total_runs,
          m.common_pairs,
          m.papers,
          m.checkpoints,
          m.missing,
        ]);
  await sheet(
    "요약",
    [
      "분석ID",
      "분석hash",
      "분리 조건",
      "지표",
      "생성자",
      "값",
      "적격run",
      "전체run",
      "공통 revision×반복",
      "논문수",
      "분기점수",
      "누락",
    ],
    summary,
  );
  await sheet(
    "논문_분기점",
    [
      "논문ID",
      "제목",
      "분기점ID",
      "revisionID",
      "계획ID",
      "공개입력hash",
      "기준hash",
      "입력 snapshot",
    ],
    (data.inputs || []).map((i: Json) => [
      i.paper_id,
      data.papers?.find((p: Json) => p.id === i.paper_id)?.title,
      i.checkpoint_id,
      i.revision_id,
      i.plan_id,
      i.input_hash,
      i.reference_hash,
      stable(i.snapshot),
    ]),
  );
  const ideas: any[][] = [],
    selections: any[][] = [],
    useful: any[][] = [],
    agreement: any[][] = [];
  for (const r of data.runs || []) {
    const m = runMetrics(r);
    for (const i of r.ideas || []) {
      ideas.push([
        i.id,
        r.id,
        r.plan_id,
        r.revision_id,
        r.repeat_index,
        r.generator,
        r.cohort,
        r.transport,
        r.input_mode,
        i.candidate_id,
        i.title,
        i.idea_md,
        i.why_helpful_md,
        stable(i.next_steps),
        stable(i.assumptions),
        stable(i.unverified_points),
        m.review_flags.includes(i.candidate_id),
      ]);
      for (const u of i.usefulness || [])
        useful.push([
          r.id,
          i.id,
          i.candidate_id,
          u.judge,
          u.score,
          u.body.validity,
          u.body.rationale_md,
          stable(u.body.concerns),
          u.body.unable_reason,
          u.attempt_id,
        ]);
      for (const a of i.agreement || [])
        agreement.push([
          r.id,
          i.id,
          i.candidate_id,
          a.judge,
          a.label,
          a.body.rationale_md,
          stable(a.body.corresponding_elements),
          a.body.unable_reason,
          a.attempt_id,
        ]);
    }
    selections.push([
      r.id,
      r.plan_id,
      r.generator,
      r.repeat_index,
      r.selected,
      r.selection?.body?.rationale_md,
      r.selection?.body?.risks_md,
      ...metricNames.map((k) => m[k]),
      r.human_corrected,
    ]);
  }
  await sheet(
    "후보_아이디어",
    [
      "ideaID",
      "runID",
      "planID",
      "revisionID",
      "반복",
      "생성자",
      "코호트",
      "경로",
      "입력모드",
      "canonicalID",
      "제목",
      "아이디어",
      "장애물에 유용한 이유",
      "다음 단계",
      "가정",
      "미검증점",
      "검토 플래그",
    ],
    ideas,
  );
  await sheet(
    "모델_선택",
    [
      "runID",
      "planID",
      "생성자",
      "반복",
      "선택ID",
      "선택 근거",
      "위험",
      ...metricNames,
      "사람 정정",
    ],
    selections,
  );
  await sheet(
    "유용성_평가",
    [
      "runID",
      "ideaID",
      "canonicalID",
      "평가자",
      "점수",
      "validity",
      "근거",
      "우려",
      "판단 불가 사유",
      "attemptID",
    ],
    useful,
  );
  await sheet(
    "일치도_평가",
    [
      "runID",
      "ideaID",
      "canonicalID",
      "평가자",
      "label",
      "근거",
      "대응 요소",
      "판단 불가 사유",
      "attemptID",
    ],
    agreement,
  );
  await sheet(
    "사람_검토",
    [
      "reviewID",
      "ideaID",
      "reviewerID",
      "층",
      "단계",
      "버전",
      "판단",
      "표집 manifest",
    ],
    [
      ...(data.reviews || []).map((v: Json) => [
        v.id,
        v.idea_id,
        v.reviewer_id,
        v.stratum,
        v.phase,
        v.version_no,
        stable(v.body),
        null,
      ]),
      ...(data.review_samples || []).map((s: Json) => [
        s.id,
        null,
        null,
        null,
        "표집",
        null,
        null,
        stable(s.manifest),
      ]),
    ],
  );
  await sheet(
    "오류_미완료",
    ["jobID", "runID", "planID", "단계", "제공사", "상태", "오류", "다음 시각"],
    (data.jobs || [])
      .filter((j: Json) => j.status !== "complete")
      .map((j: Json) => [
        j.id,
        j.run_id,
        j.plan_id,
        j.stage,
        j.provider,
        j.status,
        j.last_error,
        j.due_at,
      ]),
  );
  await sheet(
    "실행_조건",
    ["종류", "ID", "planID", "조건·usage·metadata", "snapshot hash"],
    [
      ...(data.plans || []).map((p: Json) => [
        "계획",
        p.id,
        p.id,
        stable(p),
        p.condition_hash,
      ]),
      ...(data.models || []).map((m: Json) => [
        "모델",
        m.provider,
        m.plan_id,
        stable(m.snapshot),
        null,
      ]),
      ...(data.attempts || []).map((a: Json) => [
        "시도",
        a.id,
        null,
        stable(a),
        a.response_hash,
      ]),
      [
        "분석",
        analysis.id,
        null,
        stable({
          filters: analysis.filters,
          calculation_version: data.calculation_version,
        }),
        analysis.sha256,
      ],
    ],
  );
  const perPaper: any[][] = [];
  for (const g of summarize(data.runs || []))
    for (const metric of metricNames)
      for (const [provider, m] of Object.entries(g.metrics[metric]) as any[])
        for (const p of m.per_paper || [])
          perPaper.push([
            g.condition,
            provider,
            metric,
            p.paper_id,
            p.value,
            stable(m.interval),
          ]);
  await sheet(
    "논문별_결과",
    ["조건", "모델", "지표", "논문ID", "값", "95% 논문 부트스트랩 구간"],
    perPaper,
  );
  const research = researchMetrics(data);
  await sheet(
    "ML_과제",
    [
      "runID",
      "planID",
      "논문ID",
      "유형",
      "결정지점",
      "조건",
      "생성자",
      "응답",
      "지표",
      "채점 근거",
    ],
    research.rows.map((r: Json) => [
      r.id,
      r.plan_id,
      r.paper_id,
      r.task_type,
      r.decision_point,
      r.variant,
      r.generator,
      stable(r.research_response),
      stable(r.metrics),
      r.scoring_source,
    ]),
  );
  await sheet(
    "ML_채점",
    ["reviewID", "runID", "검토자", "단계", "버전", "판정"],
    (data.research_reviews || []).map((r: Json) => [
      r.id,
      r.run_id,
      r.reviewer_code,
      r.phase,
      r.version_no,
      stable(r.body),
    ]),
  );
  await sheet(
    "실패_집계",
    ["사유", "개수"],
    Object.entries(failureCounts(data.jobs || [])),
  );
  await sheet(
    "긴텍스트_목록",
    ["원본 셀", "UTF-8 파일", "SHA-256", "문자수", "바이트수"],
    long,
  );
  return { bytes: new Uint8Array(await book.xlsx.writeBuffer()), sidecars };
}
