import { useState } from "react";
import { api } from "./api";
import { Action, Field } from "./ui";
import { save } from "./transfers";
import {
  researchMetrics,
  failureCounts,
} from "../../../packages/metrics/research";
import {
  taskLabels,
  decisionLabels,
} from "../../../packages/contracts/research";
import { type Json } from "../../../packages/contracts/core";
export function ResearchResults({ data }: { data: Json }) {
  const [independent, setIndependent] = useState(false);
  const [reviewer, setReviewer] = useState(""),
    [phase, setPhase] = useState("independent"),
    [file, setFile] = useState<File | null>(null),
    [message, setMessage] = useState("");
  const result = researchMetrics(data);
  return (
    <>
      <section className="panel">
        <h2>실패·결측 사유</h2>
        <pre>{JSON.stringify(failureCounts(data.jobs || []), null, 2)}</pre>
      </section>
      {result.rows.length > 0 && (
        <>
          <section className="panel">
            <h2>ML 과제별 결과</h2>
            <p>
              점수는 논문에 동일 가중치를 둡니다. 구간은 논문 단위 부트스트랩
              95% 구간이며, 논문이 2개 미만이면 계산하지 않습니다. 독립 채점은
              최소 2명이 필요합니다.
            </p>
            {result.groups.map((g, i) => (
              <article key={i}>
                <ResearchCondition condition={g.condition} />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>지표</th>
                        <th>값</th>
                        <th>95% 구간</th>
                        <th>적격 / 전체</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(g.metrics).map(([key, m]: any) => (
                        <tr key={key}>
                          <td>{metricLabels[key] || key}</td>
                          <td>{m.value?.toFixed(3) ?? "미채점"}</td>
                          <td>
                            {m.interval
                              ? m.interval.low.toFixed(3) +
                                " – " +
                                m.interval.high.toFixed(3)
                              : "—"}
                          </td>
                          <td>
                            {m.eligible} / {m.total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary>논문별 결과</summary>
                  <pre>{JSON.stringify(g.metrics, null, 2)}</pre>
                </details>
              </article>
            ))}
            <details>
              <summary>A/B 양쪽 순서 모두 정답인 비교 블록</summary>
              <pre>{JSON.stringify(result.paired_discrimination, null, 2)}</pre>
            </details>
            <details>
              <summary>과제별 응답 원문 구조</summary>
              {result.rows.map((r: Json) => (
                <div key={r.id}>
                  <strong>
                    {r.generator} · {r.task_type} · {r.variant} · 반복{" "}
                    {r.repeat_index}
                  </strong>
                  <pre>
                    {JSON.stringify(
                      r.research_response?.body || { status: "미완료" },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              ))}
            </details>
          </section>
        </>
      )}
      {(data.runs || []).some(
        (r: Json) => r.research_response || r.ideas?.length,
      ) && (
        <section className="panel">
          <h2>사람 독립 채점 · Excel</h2>
          <p>
            검토자마다 고유 코드를 사용해 파일을 따로 작성하세요. 두 사람의 최초
            점수와 이후 합의 점수를 별도로 보존합니다. 공개 계정은 사람의 신원을
            인증하지 않으므로 팀이 독립성을 확인해야 합니다.
          </p>
          <Field label="검토자 고유 코드">
            <input
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
          </Field>
          <Field label="채점 단계">
            <select value={phase} onChange={(e) => setPhase(e.target.value)}>
              <option value="independent">독립 최초 채점</option>
              <option value="consensus">두 명 채점 후 합의</option>
            </select>
          </Field>
          <Action
            disabled={reviewer.trim().length < 2}
            run={async () =>
              save(
                new Blob(
                  [
                    (await (
                      await import("./review-workbook")
                    ).reviewWorkbook(data, reviewer, phase)) as BlobPart,
                  ],
                  {
                    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  },
                ),
                "review-" +
                  phase +
                  "-" +
                  reviewer.replace(/[^a-zA-Z0-9_-]/g, "_") +
                  ".xlsx",
              )
            }
          >
            이 검토자용 Excel 내보내기
          </Action>
          <label className="check">
            <input
              type="checkbox"
              checked={independent}
              onChange={(e) => setIndependent(e.target.checked)}
            />
            검토자 코드가 실제 서로 다른 사람을 나타내며 독립 채점을
            확인했습니다.
          </label>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <Action
            disabled={!file || !independent}
            run={async () => {
              const p = await (
                await import("./review-workbook")
              ).readReviewWorkbook(file!, data);
              const r = await api("research-review/import", {
                ...p,
                independence_confirmed: independent,
              });
              setMessage(
                r.imported + "개 판정 저장됨. 결과를 새로고침해 확인하세요.",
              );
            }}
          >
            작성한 채점 파일 가져오기
          </Action>
          <p>{message}</p>
          <details>
            <summary>독립·합의 점수 이력</summary>
            <pre>{JSON.stringify(data.research_reviews || [], null, 2)}</pre>
          </details>
        </section>
      )}
    </>
  );
}

const metricLabels: Record<string, string> = {
  rubric_fulfillment: "채점 기준 충족률",
  discrimination_accuracy: "판별 정답률",
  valid_step_preservation: "정상 단계 보존율",
  anchor_correction: "결함 수정률",
  confirmed_critique_recall: "확정 지적 발견율",
  false_positive_fraction: "오지적 비율",
};
function ResearchCondition({ condition }: { condition: string }) {
  const c = JSON.parse(condition);
  return (
    <>
      <h3>
        {taskLabels[c.task_type]} · {decisionLabels[c.decision_point]} ·{" "}
        {c.generator}
      </h3>
      <p>
        {
          (
            {
              control: "정상 앞 단계",
              flawed: "결함이 있는 앞 단계",
              standard: "기본 순서",
              swapped: "순서 교환",
            } as Record<string, string>
          )[c.variant]
        }
      </p>
      <details>
        <summary>분리 조건</summary>
        <pre>{condition}</pre>
      </details>
    </>
  );
}
