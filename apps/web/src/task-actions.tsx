import { useState } from "react";
import { api } from "./api";
import { Action, Modal, Field } from "./ui";
import { type Json } from "../../../packages/contracts/core";
export function TaskActions({ job }: { job: Json }) {
  const [preview, setPreview] = useState<Json | null>(null),
    [open, setOpen] = useState(false),
    [evidence, setEvidence] = useState(""),
    [decision, setDecision] = useState("retry_unsent");
  const attempt = job.attempts?.at(-1);
  return (
    <span className="actions">
      <Action
        run={async () =>
          setPreview(await api("request-preview", { job_id: job.id }))
        }
      >
        전송 입력 보기
      </Action>
      {["blocked", "unknown_remote", "parse_failed"].includes(job.status) && (
        <button onClick={() => setOpen(true)}>복구</button>
      )}
      {preview && (
        <Modal title="실제 입력 구성" onClose={() => setPreview(null)}>
          <p>
            기본 지시·공개 단계·첨부 PDF·응답 스키마를 포함합니다. 후속 단계는
            생성 완료 후 볼 수 있습니다.
          </p>
          <pre>{JSON.stringify(preview, null, 2)}</pre>
          {preview.dto?.public_context?.prepared_asset?.id && (
            <Action
              run={async () => {
                const a = await api(
                  "asset?id=" + preview.dto.public_context.prepared_asset.id,
                );
                window.open(a.url, "_blank", "noopener,noreferrer");
              }}
            >
              첨부 공개 PDF
            </Action>
          )}
        </Modal>
      )}
      {open && (
        <Modal title="작업 복구" onClose={() => setOpen(false)}>
          <p>원격 처리 여부가 불명확한 작업은 자동으로 재전송하지 않습니다.</p>
          {attempt?.response_asset_id && (
            <Action
              run={async () => {
                await api("reparse", { attempt_id: attempt.id });
                setOpen(false);
              }}
            >
              저장 응답 재파싱 · 모델 재호출 없음
            </Action>
          )}
          <Field label="복구 방법">
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="retry_unsent">
                미전송·명시적 거절 확인 후 다시 대기
              </option>
              <option value="confirm_not_processed">
                제공사에서 미처리 확인 후 재예약
              </option>
              <option value="mark_failed">
                실패 확정 · 불명확한 비용은 보류
              </option>
            </select>
          </Field>
          <Field label="확인 근거 (10자 이상)">
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </Field>
          <Action
            disabled={
              evidence.trim().length < 10 || job.status === "parse_failed"
            }
            run={async () => {
              await api("reconcile", { job_id: job.id, decision, evidence });
              setOpen(false);
            }}
          >
            복구 기록 저장
          </Action>
        </Modal>
      )}
    </span>
  );
}
