import { Field } from "./ui";
import { type Json } from "../../../packages/contracts/core";
import {
  taskTypes,
  taskLabels,
  decisionLabels,
} from "../../../packages/contracts/research";
export function ResearchFields({
  body,
  set,
  disabled,
}: {
  body: Json;
  set: (key: string, value: any) => void;
  disabled: boolean;
}) {
  const type = body.task_type || "idea",
    x = body.research || {},
    change = (key: string, value: any) =>
      set("research", { ...x, [key]: value });
  const rubric = x.rubric || [],
    evidence = x.evidence || [];
  return (
    <section className="panel">
      <h2>문항 유형·채점 기준</h2>
      <Field label="문항 유형">
        <select
          aria-label="문항 유형"
          disabled={disabled}
          value={type}
          onChange={(e) => set("task_type", e.target.value)}
        >
          {taskTypes.map((t) => (
            <option key={t} value={t}>
              {taskLabels[t]}
            </option>
          ))}
        </select>
      </Field>
      {type !== "idea" && (
        <>
          <Field label="결정 지점">
            <select
              disabled={disabled}
              value={body.decision_point || ""}
              onChange={(e) => set("decision_point", e.target.value)}
            >
              <option value="">P1–P5 선택</option>
              {Object.entries(decisionLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {key} · {label}
                </option>
              ))}
            </select>
          </Field>
          {type === "discrimination" && (
            <>
              <Field label="원본 설계">
                <textarea
                  disabled={disabled}
                  value={x.original || ""}
                  onChange={(e) => change("original", e.target.value)}
                />
              </Field>
              <Field label="결함 대안">
                <textarea
                  disabled={disabled}
                  value={x.flawed || ""}
                  onChange={(e) => change("flawed", e.target.value)}
                />
              </Field>
              <small>
                A/B 순서는 자동 배정하며 순서를 바꾼 조건도 함께 실행합니다.
              </small>
            </>
          )}
          {type === "anchoring" && (
            <>
              <Field label="정상 앞 단계 (대조 조건)">
                <textarea
                  disabled={disabled}
                  value={x.control || ""}
                  onChange={(e) => change("control", e.target.value)}
                />
              </Field>
              <Field label="결함이 있는 앞 단계">
                <textarea
                  disabled={disabled}
                  value={x.flawed || ""}
                  onChange={(e) => change("flawed", e.target.value)}
                />
              </Field>
              <small>정상·결함 조건은 별도 요청으로 실행됩니다.</small>
            </>
          )}
          {["discrimination", "anchoring"].includes(type) && (
            <Field label="정답·수정 근거 (모델에 전송 안 됨)">
              <textarea
                disabled={disabled}
                value={x.answer_reason || ""}
                onChange={(e) => change("answer_reason", e.target.value)}
              />
            </Field>
          )}
          <h3>문항별 채점 기준 · 모델에 전송 안 됨</h3>
          {rubric.map((c: Json, i: number) => (
            <div className="panel" key={i}>
              {[
                ["id", "기준 ID"],
                ["description", "필수 조건·부분점수·허용 가능한 다른 답"],
              ].map(([key, label]) => (
                <Field label={label} key={key}>
                  <input
                    disabled={disabled}
                    value={c[key]}
                    onChange={(e) =>
                      change(
                        "rubric",
                        rubric.map((r: Json, j: number) =>
                          i === j ? { ...r, [key]: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
              ))}
              <Field label="최대 점수">
                <input
                  disabled={disabled}
                  type="number"
                  min={1}
                  max={10}
                  value={c.max_points}
                  onChange={(e) =>
                    change(
                      "rubric",
                      rubric.map((r: Json, j: number) =>
                        i === j ? { ...r, max_points: +e.target.value } : r,
                      ),
                    )
                  }
                />
              </Field>
              {!disabled && (
                <button
                  onClick={() =>
                    change(
                      "rubric",
                      rubric.filter((_: any, j: number) => i !== j),
                    )
                  }
                >
                  기준 삭제
                </button>
              )}
            </div>
          ))}
          {!disabled && (
            <button
              onClick={() =>
                change("rubric", [
                  ...rubric,
                  {
                    id: "R" + (rubric.length + 1),
                    description: "",
                    max_points: 1,
                  },
                ])
              }
            >
              채점 기준 추가
            </button>
          )}
          {type === "review" && (
            <>
              <h3>심사 지적 근거표 · 모델에 전송 안 됨</h3>
              {evidence.map((c: Json, i: number) => (
                <div className="panel" key={i}>
                  {[
                    ["id", "지적 ID"],
                    ["critique", "심사 지적"],
                    ["review_location", "리뷰 원문 위치"],
                    ["source_url", "출처 URL"],
                    ["submission_version", "제출본 버전"],
                    ["author_response", "저자 답변"],
                    ["revision", "수정 내용·위치"],
                  ].map(([key, label]) => (
                    <Field label={label} key={key}>
                      <textarea
                        disabled={disabled}
                        rows={2}
                        value={c[key] || ""}
                        onChange={(e) =>
                          change(
                            "evidence",
                            evidence.map((r: Json, j: number) =>
                              i === j ? { ...r, [key]: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </Field>
                  ))}
                  <Field label="근거 상태">
                    <select
                      disabled={disabled}
                      value={c.status}
                      onChange={(e) =>
                        change(
                          "evidence",
                          evidence.map((r: Json, j: number) =>
                            i === j ? { ...r, status: e.target.value } : r,
                          ),
                        )
                      }
                    >
                      <option value="confirmed">확정</option>
                      <option value="partial">부분</option>
                      <option value="raised">제기</option>
                    </select>
                  </Field>
                </div>
              ))}
              {!disabled && (
                <button
                  onClick={() =>
                    change("evidence", [
                      ...evidence,
                      { id: "E" + (evidence.length + 1), status: "raised" },
                    ])
                  }
                >
                  심사 근거 추가
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
