import { useState } from "react";
import { api } from "./api";
import { Action } from "./ui";
import { type Json } from "../../../packages/contracts/core";
export function Preflight({
  models,
  revisions,
  prompts = {},
  calls,
}: {
  models: any[];
  revisions: string[];
  prompts?: Json;
  calls?: number;
}) {
  const [data, setData] = useState<Json | null>(null);
  return (
    <section className="panel">
      <Action
        disabled={!models.length || !revisions.length}
        run={async () =>
          setData(
            await api("preflight", {
              mode: calls ? "experiment" : "probe",
              model_ids: models.filter(Boolean),
              revision_ids: revisions,
              stage_prompts: prompts,
            }),
          )
        }
      >
        실행 전 비용·한도 점검
      </Action>
      {data && (
        <>
          <p>
            예상 호출 {calls ?? 4}회 · 전체 예약 상한(모든 요청에 가장 큰 상한
            적용): $
            {(
              (calls ?? 4) *
              Math.max(
                0,
                ...data.rows.map((r: Json) => Number(r.request_cap_usd)),
              )
            ).toFixed(2)}{" "}
            · PDF와 후속 후보는 추정값입니다. 실제 전송 직전 다시 검사합니다.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>제공사·단계</th>
                  <th>예상 토큰</th>
                  <th>예상 비용 / 요청 상한</th>
                  <th>검사 결과</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: Json, i: number) => (
                  <tr key={i}>
                    <td>
                      {r.provider} / {r.stage}
                    </td>
                    <td>
                      {r.total_tokens} / TPM {r.tpm}
                    </td>
                    <td>
                      ${Number(r.estimated_usd).toFixed(4)} / $
                      {r.request_cap_usd}
                    </td>
                    <td>
                      {r.issues.join(", ") || "비용·한도 통과"}
                      <small>서버 예산 상한 ${r.server_cap_usd}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>
            이 검사는 모델 검증 통과와 실제 계정 크레딧을 대신하지 않습니다.
            생성된 후보가 길면 후속 단계 비용이 증가합니다.
          </small>
        </>
      )}
    </section>
  );
}
