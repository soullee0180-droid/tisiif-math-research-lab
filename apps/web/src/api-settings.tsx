import { Preflight } from "./preflight";
import { useState } from "react";
import { api, read } from "./api";
import { useData, Title, Field, Action, Status, Loading, ErrorBox } from "./ui";
import {
  providers,
  executionBundle,
  type Json,
} from "../../../packages/contracts/core";
export const stageLabels: Record<string, string> = {
  generate: "아이디어 생성",
  select: "후보 선택",
  usefulness: "유용성 평가",
  agreement: "일치도 평가",
};
const base: Json = executionBundle().prompts;
export function PromptFields({
  value,
  onChange,
}: {
  value: Json;
  onChange: (v: Json) => void;
}) {
  const [tab, setTab] = useState("generate");
  return (
    <>
      <div className="stage-tabs" role="tablist" aria-label="단계별 프롬프트">
        {Object.entries(stageLabels).map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <Field
        label={stageLabels[tab] + " 추가 지시"}
        hint="기본 연구 지시 뒤에 덧붙입니다. 빈칸이면 기본 프롬프트를 사용합니다."
      >
        <textarea
          aria-label={stageLabels[tab] + " 추가 지시"}
          rows={5}
          maxLength={10000}
          value={value[tab] || ""}
          onChange={(e) => onChange({ ...value, [tab]: e.target.value })}
          placeholder="예: 가능한 다음 단계를 구체적으로 쓰고, 확인하지 못한 가정을 명시하세요."
        />
      </Field>
      <details>
        <summary>이 단계의 기본 프롬프트 보기</summary>
        <pre>{base[tab].system + "\n\n" + base[tab].user_template}</pre>
      </details>
    </>
  );
}
const save = (command: string, data: Json) =>
  api("api-config/save", { command, data });
export function ApiSettings() {
  const { data, error } = useData(() => api("api-config"), [], 5000);
  const [tab, setTab] = useState("google");
  return (
    <>
      <Title
        title="API·프롬프트"
        description="공동 키와 실행 예산을 설정한 뒤, 모델을 검증하고 실험을 시작합니다."
      />
      <p className="muted">
        등록한 키는 모든 방문자가 실행에 사용할 수 있습니다. 저장 후 키 원문은
        표시하지 않습니다. API 사용료는 제공사 계정에 청구됩니다.
      </p>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <section className="panel">
            <div className="panel-toolbar">
              <h2>1. 공동 API 실행</h2>
              <Status value={data.api_enabled ? "running" : "paused"} />
            </div>
            <Action
              className="primary"
              run={() => save("toggle", { enabled: !data.api_enabled })}
            >
              {data.api_enabled ? "API 실행 끄기" : "API 실행 켜기"}
            </Action>
            <small>
              예산은 제공사별로 따로 적용합니다. 자동 작업은 서버에서 분 단위로
              진행되어 이 탭을 닫아도 이어집니다.
            </small>
          </section>
          <div className="stage-tabs" role="tablist" aria-label="API 제공사">
            {providers.map((p) => (
              <button
                role="tab"
                aria-selected={tab === p}
                key={p}
                onClick={() => setTab(p)}
              >
                {p === "google"
                  ? "Google Gemini"
                  : p === "openai"
                    ? "OpenAI GPT"
                    : "Anthropic Claude"}
              </button>
            ))}
          </div>
          <ProviderSettings key={tab} provider={tab} data={data} />
          <section className="panel">
            <h2>4. 단계별 기본 추가 지시</h2>
            <DefaultPrompts initial={data.stage_prompts} />
          </section>
        </>
      )}
    </>
  );
}
function ProviderSettings({
  provider,
  data,
}: {
  provider: string;
  data: Json;
}) {
  const existing = data.budgets.find((b: Json) => b.provider === provider),
    [key, setKey] = useState(""),
    [budget, setBudget] = useState(existing?.budget_usd || 0),
    [enabled, setEnabled] = useState(existing?.enabled || false);
  const saved = data.keys.find((k: Json) => k.provider === provider);
  return (
    <>
      <section className="panel">
        <h2>2. 키·예산</h2>
        <small>
          {saved ? "키 저장됨 · 끝 4자리 " + saved.last_four : "저장된 키 없음"}{" "}
          · 사용 ${Number(existing?.spent_usd || 0).toFixed(4)} · 예약 $
          {Number(existing?.reserved_usd || 0).toFixed(4)}
        </small>
        <div className="form-grid">
          <Field label={provider + " API 키"}>
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="새 키를 입력할 때만 작성"
            />
          </Field>
          <Action
            disabled={key.trim().length < 8}
            run={async () => {
              await api("api-config/key", { provider, key });
              setKey("");
            }}
          >
            키 저장·교체
          </Action>
          <Field label="공동 누적 예산 상한 (USD)">
            <input
              type="number"
              min="0"
              max="1000"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(+e.target.value)}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            이 제공사 호출 허용
          </label>
        </div>
        <p>
          서버 예산 상한: $
          {data.server_caps?.find((c: Json) => c.provider === provider)
            ?.limit_usd ?? 0}{" "}
          · 공개 화면에서 올릴 수 없습니다.
        </p>
        <small>
          잔액 직접 확인 유효기한:{" "}
          {existing?.org_verified_at
            ? new Date(
                Date.parse(existing.org_verified_at) + 86400000,
              ).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
            : "미확인"}{" "}
          (KST)
        </small>
        <p className="muted">
          실제 제공사 잔액 조회 기능은 아닙니다. 상한은 사용액과 예약액을 합쳐
          검사합니다. 제공사 잔액과 사용 한도를 확인한 후 저장하세요.
        </p>
        <Action
          disabled={!Number.isFinite(budget) || budget < 0}
          run={() =>
            save("budget_save", {
              provider,
              budget_usd: budget,
              enabled,
              org_verified: true,
            })
          }
        >
          예산 저장 · 제공사 잔액 직접 확인 기록
        </Action>
        <Action run={() => save("provider_pause", { provider, paused: false })}>
          오류 차단 해제
        </Action>
      </section>
      <section className="panel">
        <h2>3. 모델 등록·검증</h2>
        <ProviderLimits
          provider={provider}
          initial={data.providers.find((p: Json) => p.provider === provider)}
        />
        {data.models
          .filter((m: Json) => m.provider === provider)
          .map((m: Json) => (
            <Model key={m.id} model={m} probes={data.probes || []} />
          ))}
        <ModelForm provider={provider} />
      </section>
    </>
  );
}
function Model({ model: m, probes }: { model: Json; probes: Json[] }) {
  const { data: revisions } = useData(() => read("revisions"), [], 5000);
  const [id, setId] = useState(""),
    [clone, setClone] = useState(false);
  const revision = revisions?.find((r: Json) => r.id === id),
    active = probes.filter(
      (p) => p.profile_id === m.id && ["queued", "running"].includes(p.status),
    );
  const ready = ["generate", "select", "usefulness", "agreement"].every(
    (s) => m.capabilities?.stages?.[s]?.status === "PASS",
  );
  return (
    <article className="model-row">
      <strong>{m.model_id}</strong>{" "}
      <Status value={m.enabled ? "활성" : "비활성"} />
      <p>
        인증·모델 접근: {ready ? "텍스트 실제 응답으로 확인" : "검증 필요"} ·
        텍스트 {m.capabilities?.text || "NOT_RUN"} · PDF{" "}
        {m.capabilities?.pdf || "NOT_RUN"}
      </p>
      {(["text", "pdf"] as const).map((mode) => (
        <div key={mode}>
          <strong>{mode.toUpperCase()}</strong>
          <div className="probe-status">
            {Object.entries(stageLabels).map(([s, label]) => {
              const pending = active.find(
                  (p) => p.mode === mode && p.stage === s,
                ),
                e =
                  m.capabilities?.[mode === "pdf" ? "pdf_stages" : "stages"]?.[
                    s
                  ];
              return (
                <span key={s}>
                  {label}{" "}
                  <Status value={pending?.status || e?.status || "NOT_RUN"} />
                  {(e?.error || pending?.error) && (
                    <small>{e?.error || pending?.error}</small>
                  )}
                  {e?.cost_usd !== undefined && (
                    <small>${Number(e.cost_usd).toFixed(5)}</small>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      <Action
        run={async () => {
          const r = await api("api-config/example", {});
          setId(r.id);
        }}
      >
        기본 텍스트 검증 예제 선택
      </Action>
      <Field label={m.model_id + " 검증용 승인 분기점"}>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">승인된 텍스트 또는 PDF 선택</option>
          {revisions?.map((r: Json) => (
            <option value={r.id} key={r.id}>
              {r.paper_title} · {r.checkpoint_title} · {r.body.input_mode}
            </option>
          ))}
        </select>
      </Field>
      <Preflight models={[m.id]} revisions={id ? [id] : []} />
      <div className="actions">
        <Action
          disabled={
            !id || active.some((p) => p.mode === revision?.body.input_mode)
          }
          run={() =>
            api("api-config/probe", {
              profile_id: m.id,
              revision_id: id,
              mode: revision?.body.input_mode || "text",
            })
          }
        >
          4단계 실제 검증 예약
        </Action>
        <Action
          disabled={!ready && !m.enabled}
          run={() => save("model_enable", { id: m.id, enabled: !m.enabled })}
        >
          {m.enabled ? "모델 사용 중지" : "이 모델 사용"}
        </Action>
        <button onClick={() => setClone(!clone)}>설정 복제·새 버전</button>
      </div>
      <small>
        텍스트 네 단계가 모두 통과해야 활성화됩니다. PDF를 쓰려면 PDF 네 단계도
        검증하세요. 검증 예약은 유료 추론 요청 4회를 사용하며 진행 중 중복
        예약은 차단됩니다.
      </small>
      {clone && <ModelForm provider={m.provider} source={m} />}
    </article>
  );
}
function ModelForm({ provider, source }: { provider: string; source?: Json }) {
  const [id, setId] = useState(source?.model_id || ""),
    [output, setOutput] = useState(source?.output_cap || 4096),
    [inputPrice, setInput] = useState(
      String(source?.pricing?.input_per_million ?? ""),
    ),
    [outputPrice, setPrice] = useState(
      String(source?.pricing?.output_per_million ?? ""),
    ),
    [reserve, setReserve] = useState(
      String(source?.pricing?.max_request_usd ?? "0.50"),
    ),
    [params, setParams] = useState(
      JSON.stringify(source?.parameters || {}, null, 2),
    ),
    [cache, setCache] = useState<Json>(source?.pricing || {});
  return (
    <details open>
      <summary>
        {source ? "기존 기록을 보존하는 새 설정" : "새 모델 등록"}
      </summary>
      <Field label="정확한 API 모델 ID">
        <input value={id} onChange={(e) => setId(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="최대 출력 토큰">
          <input
            type="number"
            min="256"
            max="32768"
            value={output}
            onChange={(e) => setOutput(+e.target.value)}
          />
        </Field>
        <Field label="요청당 최대 예약 비용 (USD)">
          <input
            type="number"
            min="0.001"
            step="0.001"
            value={reserve}
            onChange={(e) => setReserve(e.target.value)}
          />
        </Field>
        <Field label="입력 100만 토큰 가격 (USD)">
          <input
            type="number"
            min="0"
            step="0.001"
            value={inputPrice}
            onChange={(e) => setInput(e.target.value)}
          />
        </Field>
        <Field label="출력 100만 토큰 가격 (USD)">
          <input
            type="number"
            min="0"
            step="0.001"
            value={outputPrice}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
      </div>
      <details>
        <summary>추론·샘플링 설정 / 캐시 가격</summary>
        <Field label="제공사별 추가 파라미터 JSON">
          <textarea
            rows={5}
            value={params}
            onChange={(e) => setParams(e.target.value)}
          />
        </Field>
        <small>
          모델 ID·출력 한도·도구·입력·응답 형식은 추가 파라미터로 변경할 수
          없습니다.
        </small>
        {[
          "cache_read_per_million",
          "cache_write_per_million",
          "cache_write_5m_per_million",
          "cache_write_1h_per_million",
        ].map((key) => (
          <Field label={key + " (USD)"} key={key}>
            <input
              type="number"
              min="0"
              step="0.001"
              value={cache[key] ?? ""}
              onChange={(e) =>
                setCache({
                  ...cache,
                  [key]: e.target.value === "" ? undefined : +e.target.value,
                })
              }
            />
          </Field>
        ))}
      </details>
      <small>
        공식 단가를 입력하세요. 새 설정은 다시 검증하며 기존 실험의 모델·가격은
        변경하지 않습니다.
      </small>
      <Action
        disabled={
          !id.trim() ||
          inputPrice === "" ||
          outputPrice === "" ||
          !(+reserve > 0)
        }
        run={async () => {
          await save("model_save", {
            provider,
            model_id: id.trim(),
            api_family:
              provider === "google"
                ? "generate_content"
                : provider === "openai"
                  ? "responses"
                  : "messages",
            parameters: JSON.parse(params),
            output_cap: output,
            pricing: {
              ...cache,
              input_per_million: +inputPrice,
              output_per_million: +outputPrice,
              max_request_usd: +reserve,
            },
          });
          setId("");
        }}
      >
        새 모델 설정 등록
      </Action>
    </details>
  );
}
function DefaultPrompts({ initial }: { initial: Json }) {
  const [value, setValue] = useState(initial || {});
  return (
    <>
      <PromptFields value={value} onChange={setValue} />
      <Action
        className="primary"
        run={() => save("prompts", { stage_prompts: value })}
      >
        기본 추가 지시 저장
      </Action>
      <small>
        새 실험에만 적용됩니다. 실험 만들기에서 개별 변경할 수 있습니다.
      </small>
    </>
  );
}

function ProviderLimits({
  provider,
  initial,
}: {
  provider: string;
  initial: Json;
}) {
  const [rpm, setRpm] = useState(initial?.rpm || 5),
    [tpm, setTpm] = useState(initial?.tpm || 100000),
    [interval, setInterval] = useState(
      (initial?.min_interval_ms || 15000) / 1000,
    );
  return (
    <details>
      <summary>제공사 호출 한도 (PDF·긴 입력 사용 시 확인)</summary>
      <div className="form-grid">
        <Field label="분당 요청 수 RPM">
          <input
            type="number"
            min="1"
            max="10000"
            value={rpm}
            onChange={(e) => setRpm(+e.target.value)}
          />
        </Field>
        <Field label="분당 토큰 수 TPM">
          <input
            type="number"
            min="1000"
            max="1000000000"
            value={tpm}
            onChange={(e) => setTpm(+e.target.value)}
          />
        </Field>
        <Field label="요청 간격 (초)">
          <input
            type="number"
            min="1"
            max="60"
            value={interval}
            onChange={(e) => setInterval(+e.target.value)}
          />
        </Field>
      </div>
      <small>
        실제 제공사 콘솔의 한도 이하로 설정하세요. 앱의 보수적 토큰 예상치가
        TPM을 넘으면 차단합니다.
      </small>
      <Action
        run={() =>
          save("limits", {
            provider,
            rpm,
            tpm,
            min_interval_ms: interval * 1000,
          })
        }
      >
        호출 한도 저장
      </Action>
    </details>
  );
}
