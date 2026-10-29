import { Preflight } from "./preflight";
import { TaskActions } from "./task-actions";
import { PromptFields } from "./api-settings";
import { useState } from "react";
import {
  Plus,
  ArrowLeft,
  Play,
  Pause,
  Clipboard,
  ArrowUpRight,
} from "lucide-react";
import { read, write, api, navigate, kst } from "./api";
import {
  useData,
  Title,
  Field,
  Modal,
  Empty,
  Loading,
  ErrorBox,
  Action,
  Status,
  Markdown,
} from "./ui";
import {
  providers,
  providerNames,
  type Provider,
  type Json,
} from "../../../packages/contracts/core";
export function Experiments() {
  const { data, error } = useData(() => read("plans"), [], 5000);
  const [create, setCreate] = useState(false);
  return (
    <>
      <Title
        title="실험 계획"
        description="승인 입력과 모델 조건을 고정하고, 공동 실험을 함께 확인합니다."
      >
        <button className="primary" onClick={() => setCreate(true)}>
          <Plus size={17} /> 새 실험 계획
        </button>
      </Title>
      <div className="stat-grid">
        <article>
          <span>기본 설계</span>
          <strong>
            5 <small>후보 ×</small> 2 <small>반복</small>
          </strong>
          <p>선택한 모델끼리 상호 채점</p>
        </article>
        <article>
          <span>실제 API</span>
          <strong>공동 키</strong>
          <p>
            <a href="/api-settings">키·모델·예산 설정</a>
          </p>
        </article>
        <article>
          <span>예약 기준</span>
          <strong>Asia/Seoul</strong>
          <p>클라우드 예약은 분 단위로 기동합니다.</p>
        </article>
      </div>
      <section className="panel">
        <div className="panel-toolbar">
          <h2>공동 실험</h2>
        </div>
        <ErrorBox error={error} />
        {!data ? (
          <Loading />
        ) : !data.length ? (
          <Empty title="아직 실험 계획이 없습니다">
            승인한 분기점과 실행할 모델을 선택하세요.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>계획</th>
                  <th>경로·코호트</th>
                  <th>진행</th>
                  <th>상태</th>
                  <th>예약 시각</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((p: Json) => (
                  <tr key={p.id}>
                    <td>
                      <a
                        href={"/experiments/" + p.id}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate("/experiments/" + p.id);
                        }}
                      >
                        {p.name}
                      </a>
                      <small>
                        K={p.k} · R={p.repeats}
                      </small>
                    </td>
                    <td>
                      <Status value={p.transport} /> <Status value={p.cohort} />
                    </td>
                    <td>
                      {p.complete} / {p.total}
                      <progress value={p.complete} max={p.total} />
                    </td>
                    <td>
                      <Status value={p.status} />
                    </td>
                    <td>{kst(p.scheduled_at)}</td>
                    <td>
                      <button
                        className="icon"
                        onClick={() => navigate("/experiments/" + p.id)}
                        aria-label={p.name + " 열기"}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {create && <PlanForm onClose={() => setCreate(false)} />}
    </>
  );
}
function PlanForm({ onClose }: { onClose: () => void }) {
  const { data: revisions } = useData(() => read("revisions")),
    { data: config } = useData(() => api("api-config"));
  const [modelIds, setModelIds] = useState<Json>({}),
    [prompts, setPrompts] = useState<Json>({});
  const [selected, setSelected] = useState<Provider[]>(["google", "openai"]),
    [reveal, setReveal] = useState(false);
  const [name, setName] = useState("새 예비 실험"),
    [k, setK] = useState(5),
    [repeats, setRepeats] = useState(2),
    [transport, setTransport] = useState("api"),
    [cohort, setCohort] = useState("pilot"),
    [ids, setIds] = useState<string[]>([]),
    [schedule, setSchedule] = useState("");
  const n = selected.length,
    runs = ids.reduce((sum, id) => {
      const t = revisions?.find((r: Json) => r.id === id)?.body.task_type;
      return (
        sum +
        n * repeats * (["discrimination", "anchoring"].includes(t) ? 2 : 1)
      );
    }, 0),
    jobs = ids.reduce((sum, id) => {
      const t =
        revisions?.find((r: Json) => r.id === id)?.body?.task_type || "idea";
      return (
        sum +
        n *
          repeats *
          (t === "idea"
            ? 2 * n
            : ["discrimination", "anchoring"].includes(t)
              ? 2
              : 1)
      );
    }, 0);
  const missing = transport === "api" && selected.some((p) => !modelIds[p]);
  return (
    <Modal title="실험 계획 만들기" onClose={onClose}>
      <Field label="계획 이름">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="실행 경로">
          <select
            aria-label="실행 경로"
            value={transport}
            onChange={(e) => {
              setTransport(e.target.value);
              setCohort(e.target.value === "mock" ? "fixture" : "pilot");
            }}
          >
            <option value="api">API 자동 실행 · 공동 키 사용</option>
            <option value="manual_web">
              수동 웹 채팅 · 저장 결과 직접 입력
            </option>
            <option value="mock">모의 · 합성 fixture</option>
          </select>
        </Field>
        <Field label="코호트">
          <select
            aria-label="코호트"
            disabled={transport === "mock"}
            value={cohort}
            onChange={(e) => setCohort(e.target.value)}
          >
            {transport === "mock" ? (
              <option value="fixture">fixture</option>
            ) : (
              <>
                <option value="pilot">예비</option>
                <option value="main">본실험</option>
              </>
            )}
          </select>
        </Field>
        <Field label="후보 수 K">
          <input
            type="number"
            min={1}
            max={10}
            value={k}
            onChange={(e) => setK(+e.target.value)}
          />
        </Field>
        <Field label="독립 반복 R">
          <input
            type="number"
            min={1}
            max={10}
            value={repeats}
            onChange={(e) => setRepeats(+e.target.value)}
          />
        </Field>
      </div>
      <fieldset className="execution-options">
        <legend>실행 모델 선택</legend>
        <p className="muted">
          체크한 제공사만 실행합니다. 기존 아이디어 문항은 두 모델 이상이면
          서로의 출력을 채점하고, 자기 출력은 채점하지 않습니다.
        </p>
        {providers.map((p) => (
          <div className="model-choice" key={p}>
            <label className="check">
              <input
                type="checkbox"
                checked={selected.includes(p)}
                onChange={(e) =>
                  setSelected(
                    providers.filter((x) =>
                      x === p ? e.target.checked : selected.includes(x),
                    ),
                  )
                }
              />
              {providerNames[p]} 포함
            </label>
            {transport === "api" && selected.includes(p) && (
              <Field label={providerNames[p] + " 모델"}>
                <select
                  aria-label={providerNames[p] + " 모델"}
                  value={modelIds[p] || ""}
                  onChange={(e) =>
                    setModelIds({ ...modelIds, [p]: e.target.value })
                  }
                >
                  <option value="">사용할 검증 모델 선택</option>
                  {config?.models
                    .filter((m: Json) => m.provider === p && m.enabled)
                    .map((m: Json) => (
                      <option key={m.id} value={m.id}>
                        {m.model_id}
                      </option>
                    ))}
                </select>
                {!config?.models.some(
                  (m: Json) => m.provider === p && m.enabled,
                ) && (
                  <small>
                    <a href="/api-settings">
                      API 설정에서 키·모델을 등록하고 검증하세요.
                    </a>
                  </small>
                )}
              </Field>
            )}
          </div>
        ))}
        {n === 1 && (
          <p className="muted">
            모델 하나: 생성·선택만 실행합니다. 상호 채점과 관련 지표는 없습니다.
          </p>
        )}
        {n === 0 && (
          <p className="text-error">실행할 모델을 하나 이상 선택하세요.</p>
        )}
      </fieldset>
      <fieldset className="execution-options">
        <legend>채점 입력 설정</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
          />
          상호 채점 입력에 출력을 생성한 AI 이름 표시
        </label>
        <small>
          {reveal
            ? "평가할 이전 출력 맨 뒤에 생성 AI 이름을 붙입니다."
            : "생성 AI 이름을 추가하지 않습니다."}{" "}
          이 설정은 계획 생성 시 고정되며, 다른 설정의 결과와 분리됩니다.
        </small>
      </fieldset>
      <div className="field">
        <span>승인된 분기점</span>
        <div className="select-list" role="group" aria-label="승인된 분기점">
          {revisions?.map((r: Json) => (
            <label key={r.id}>
              <input
                type="checkbox"
                checked={ids.includes(r.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, r.id]
                      : ids.filter((id) => id !== r.id),
                  )
                }
              />
              <div>
                {r.paper_title}
                <small>
                  {r.checkpoint_title} · v{r.version_no} · {r.body.input_mode} ·{" "}
                  {r.body.task_type || "idea"} {r.body.decision_point || ""}
                </small>
              </div>
            </label>
          ))}
          {revisions?.length === 0 && <p>먼저 분기점을 승인해 주세요.</p>}
        </div>
      </div>
      <details>
        <summary>예약·단계별 추가 프롬프트</summary>
        <Field
          label="예약 시각 (Asia/Seoul)"
          hint="비워 두면 시작 버튼을 누른 뒤 바로 대기열에 들어갑니다."
        >
          <input
            type="datetime-local"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
        </Field>
        <PromptFields
          value={{ ...config?.stage_prompts, ...prompts }}
          onChange={setPrompts}
        />
      </details>
      <div className="design-summary">
        {ids.length}개 분기점 × {n}생성자 × {repeats}반복 ={" "}
        <strong>
          {runs} run · {jobs}개 작업
        </strong>
        <small>
          기존 아이디어 run당 생성·선택 2회 + {Math.max(0, n - 1)}개 다른 모델의
          유용성·일치도 평가
        </small>
      </div>
      {transport === "api" && (
        <Preflight
          models={selected.map((p) => modelIds[p]).filter(Boolean)}
          revisions={ids}
          prompts={{ ...config?.stage_prompts, ...prompts }}
          calls={jobs}
        />
      )}
      <Action
        className="primary"
        disabled={
          !ids.length ||
          !name ||
          !n ||
          k < 1 ||
          k > 10 ||
          repeats < 1 ||
          repeats > 10 ||
          missing
        }
        run={async () => {
          const r = await write("plan_create", {
            name,
            k,
            repeats,
            transport,
            cohort,
            revision_ids: ids,
            selected_providers: selected,
            reveal_generator_identity: reveal,
            model_ids: Object.fromEntries(
              selected.filter((p) => modelIds[p]).map((p) => [p, modelIds[p]]),
            ),
            stage_prompts: { ...config?.stage_prompts, ...prompts },
            scheduled_at: schedule
              ? new Date(schedule + ":00+09:00").toISOString()
              : null,
          });
          navigate("/experiments/" + r.id);
        }}
      >
        일시정지 상태로 계획 생성
      </Action>
    </Modal>
  );
}
export function Experiment({ id }: { id: string }) {
  const { data, error } = useData(() => read("plan", { id }), [id], 5000);
  const [manual, setManual] = useState<Json | null>(null);
  if (!data)
    return (
      <>
        <ErrorBox error={error} />
        <Loading />
      </>
    );
  return (
    <>
      <button className="text-button" onClick={() => navigate("/experiments")}>
        <ArrowLeft size={16} /> 실험 계획
      </button>
      <Title
        title={data.name}
        description={
          "K=" +
          data.k +
          " · R=" +
          data.repeats +
          " · 예약 " +
          kst(data.scheduled_at)
        }
      >
        <Status value={data.status} />
        {!["complete", "cancelled"].includes(data.status) && (
          <>
            <Action
              className="primary"
              run={() =>
                write("plan_control", {
                  id,
                  status: data.status === "running" ? "paused" : "running",
                })
              }
            >
              {data.status === "running" ? (
                <Pause size={16} />
              ) : (
                <Play size={16} />
              )}{" "}
              {data.status === "running" ? "일시정지" : "시작·재개"}
            </Action>
            <Action
              run={() => write("plan_control", { id, status: "cancelled" })}
            >
              계획 취소
            </Action>
          </>
        )}
        {["mock", "api"].includes(data.transport) &&
          data.status === "running" && <MockStep />}
        <button onClick={() => navigate("/results?plan=" + id)}>
          이 계획 결과 보기
        </button>
      </Title>
      <div className="notice">
        <span>
          실행 모델:{" "}
          {(data.protocol.selected_providers || providers)
            .map((p: Provider) => providerNames[p])
            .join(" · ")}
        </span>
        <span>
          생성 AI 이름:{" "}
          {data.protocol.reveal_generator_identity ? "공개" : "비공개"}
        </span>
        {data.protocol.selected_providers?.length === 1 && (
          <span>단일 모델 · 상호 채점 없음</span>
        )}
      </div>
      <details>
        <summary>이 실험에 고정된 단계별 추가 프롬프트</summary>
        <pre>{JSON.stringify(data.protocol.stage_prompts || {}, null, 2)}</pre>
      </details>
      <div className="notice">
        <Status value={data.transport} />
        <Status value={data.cohort} />
        <span>
          {data.transport === "manual_web"
            ? "각 단계를 새 채팅에서 실행한 뒤 원문을 그대로 입력하세요. 다른 판단과 섞지 않습니다."
            : data.transport === "mock"
              ? "합성 fixture만 사용합니다. 실제 연구 결과나 모델 검수 성공이 아닙니다."
              : "원격 처리 여부가 불명인 요청은 자동으로 다시 보내지 않습니다."}
        </span>
      </div>
      {data.runs.map((r: Json) => (
        <section className="panel run" key={r.id}>
          <div className="panel-toolbar">
            <h2>
              {r.generator} <small>독립 반복 {r.repeat_index}</small>
            </h2>
            <code>{r.id.slice(0, 8)}</code>
          </div>
          <div className="job-grid">
            {r.jobs.map((j: Json) => (
              <article key={j.id}>
                <div>
                  <strong>{j.stage}</strong>
                  <span>{j.provider}</span>
                </div>
                <Status value={j.status} />
                <TaskActions job={j} />
                {j.last_error && (
                  <small className="text-error">{j.last_error}</small>
                )}
                {data.transport === "manual_web" &&
                  data.status === "running" &&
                  ["queued", "running", "parse_failed"].includes(j.status) && (
                    <Action
                      run={async () =>
                        setManual({
                          ...(await api("manual/prompt", { job_id: j.id })),
                          stage: j.stage,
                          provider: j.provider,
                        })
                      }
                    >
                      <Clipboard size={14} /> 프롬프트·응답
                    </Action>
                  )}
                {j.status === "parse_failed" &&
                  j.attempts?.at(-1)?.response_asset_id && (
                    <Action
                      run={() =>
                        api("reparse", { attempt_id: j.attempts.at(-1).id })
                      }
                    >
                      저장 원문 재파싱
                    </Action>
                  )}
                {j.attempts?.length > 0 && (
                  <details>
                    <summary>시도 {j.attempts.length} · 원문·조건</summary>
                    {j.attempts.map((t: Json) => (
                      <div key={t.id}>
                        <small>
                          {t.milestone} · {kst(t.created_at)}
                        </small>
                        <details>
                          <summary>입력 snapshot / mapping</summary>
                          <pre>
                            {JSON.stringify(t.request_snapshot, null, 2)}
                          </pre>
                        </details>
                        <pre>{JSON.stringify(t.metadata, null, 2)}</pre>
                        {[
                          ["request_asset_id", "요청 원문"],
                          ["response_asset_id", "응답 원문"],
                        ].map(
                          ([key, label]) =>
                            t[key] && (
                              <Action
                                key={key}
                                run={async () => {
                                  const x = await api("asset?id=" + t[key]);
                                  window.open(
                                    x.url,
                                    "_blank",
                                    "noopener,noreferrer",
                                  );
                                }}
                              >
                                {label} 다운로드
                              </Action>
                            ),
                        )}
                      </div>
                    ))}
                  </details>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
      {manual && <Manual data={manual} onClose={() => setManual(null)} />}
    </>
  );
}
function Manual({ data, onClose }: { data: Json; onClose: () => void }) {
  const [raw, setRaw] = useState(data.original_raw || ""),
    [correction, setCorrection] = useState(""),
    [model, setModel] = useState(""),
    [mode, setMode] = useState(""),
    [time, setTime] = useState(""),
    [tools, setTools] = useState("unknown"),
    [search, setSearch] = useState("unknown"),
    [memory, setMemory] = useState("unknown"),
    [corrected, setCorrected] = useState(false);
  return (
    <Modal
      title={data.provider + " · " + data.stage + " 수동 실행"}
      onClose={onClose}
    >
      <div className="notice">
        새 대화에서 시스템 지시·과제·schema를 전달하세요. PDF 입력이면 승인 공개
        PDF만 첨부하세요.
      </div>
      <Action
        run={() =>
          navigator.clipboard.writeText(
            data.system +
              "\n\n" +
              data.prompt +
              "\n\nRESPONSE SCHEMA\n" +
              JSON.stringify(data.schema, null, 2),
          )
        }
      >
        전체 프롬프트 복사
      </Action>
      {data.prepared_asset_id && (
        <Action
          run={async () => {
            const r = await api("asset?id=" + data.prepared_asset_id);
            window.open(r.url, "_blank", "noopener,noreferrer");
          }}
        >
          첨부할 공개 PDF
        </Action>
      )}
      <details>
        <summary>전달 내용과 mapping 확인</summary>
        <pre>
          {data.system +
            "\n\n" +
            data.prompt +
            "\n\n" +
            JSON.stringify(data.schema, null, 2)}
        </pre>
        <pre>{JSON.stringify(data.mapping, null, 2)}</pre>
      </details>
      <Field label="모델 응답 원문">
        <textarea
          rows={12}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="JSON 응답을 수정 없이 붙여 넣으세요."
        />
      </Field>
      <div className="form-grid">
        <Field label="화면에 표시된 모델 (모르면 공란)">
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="표시된 모드">
          <input value={mode} onChange={(e) => setMode(e.target.value)} />
        </Field>
        <Field label="실제 실행 시각 (KST)">
          <input
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
        {[
          ["도구", tools, setTools],
          ["검색", search, setSearch],
          ["메모리", memory, setMemory],
        ].map(([label, value, set]: any) => (
          <Field key={label} label={label}>
            <select value={value} onChange={(e) => set(e.target.value)}>
              <option value="unknown">확인 못 함</option>
              <option value="off">꺼짐 확인</option>
              <option value="on">켜짐 확인</option>
            </select>
          </Field>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={corrected}
          onChange={(e) => setCorrected(e.target.checked)}
        />{" "}
        사람이 내용을 정정한 응답 (주 분석에서 제외)
      </label>
      {corrected && (
        <Field label="정정 JSON (원문과 별도로 보존)">
          <textarea
            rows={8}
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
          />
        </Field>
      )}
      <Action
        className="primary"
        disabled={
          !raw.trim() || data.complete || (corrected && !correction.trim())
        }
        run={async () => {
          await api("manual/response", {
            attempt_id: data.attempt_id,
            raw,
            model: model || null,
            mode: mode || null,
            actual_at: time ? new Date(time + ":00+09:00").toISOString() : null,
            tools: tools === "unknown" ? null : tools,
            search: search === "unknown" ? null : search,
            memory: memory === "unknown" ? null : memory,
            human_corrected: corrected,
            corrected_json: corrected ? JSON.parse(correction) : null,
          });
          onClose();
        }}
      >
        원문 보존·검수 후 제출
      </Action>
    </Modal>
  );
}
export function Queue() {
  const { data, error } = useData(() => read("queue"), [], 5000);
  return (
    <>
      <Title
        title="실행 현황"
        description="제공사별 처리 상태와 안전하게 재개할 작업을 확인합니다."
      />
      <ErrorBox error={error} />
      <MockStep />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="stat-grid">
            {data.providers.map((p: Json) => (
              <article key={p.provider}>
                <div className="provider">
                  <span className={"provider-dot " + p.provider} />
                  <strong>{p.provider}</strong>
                </div>
                <p>
                  <Status
                    value={p.paused || p.blocked_reason ? "blocked" : "queued"}
                  />{" "}
                  {p.blocked_reason || "기동 대기"}
                </p>
                <dl>
                  <dt>전역 동시성</dt>
                  <dd>1</dd>
                  <dt>RPM / TPM</dt>
                  <dd>
                    {p.rpm} / {p.tpm.toLocaleString()}
                  </dd>
                  <dt>최근 성공</dt>
                  <dd>{kst(p.last_success)}</dd>
                  <dt>다음 허용</dt>
                  <dd>{kst(p.next_allowed_at)}</dd>
                </dl>
              </article>
            ))}
          </div>
          <section className="panel">
            <div className="panel-toolbar">
              <h2>클라우드 스케줄러</h2>
              <Status value={data.scheduler?.enabled ? "running" : "paused"} />
            </div>
            <p>
              최근 확인 {kst(data.scheduler?.last_tick)} · 최근 기동{" "}
              {kst(data.scheduler?.last_dispatch)}
            </p>
            <small>
              할 일이 없으면 Edge 요청을 만들지 않습니다. 브라우저 PDF
              준비·업로드·다운로드는 해당 탭이 열려 있어야 합니다.
            </small>
          </section>
          <section className="panel">
            <h2>대기·미완료 작업</h2>
            {!data.jobs.length ? (
              <Empty title="대기 중인 작업이 없습니다" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>제공사</th>
                      <th>단계</th>
                      <th>상태</th>
                      <th>다음 시각</th>
                      <th>이유</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j: Json) => (
                      <tr key={j.id}>
                        <td>{j.provider}</td>
                        <td>{j.stage}</td>
                        <td>
                          <Status value={j.status} />
                          <TaskActions job={j} />
                        </td>
                        <td>{kst(j.due_at)}</td>
                        <td>{j.last_error || "—"}</td>
                        <td>
                          <button
                            onClick={() =>
                              navigate("/experiments/" + j.plan_id)
                            }
                          >
                            계획 열기
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function MockStep() {
  const [message, setMessage] = useState("");
  return (
    <div className="actions">
      <Action
        run={async () => {
          const r = await api("api/dispatch", {});
          setMessage(
            r.accepted
              ? "자동 처리 요청을 보냈습니다."
              : "잠시 후 다시 시도하세요.",
          );
        }}
      >
        지금 처리 요청
      </Action>
      <small aria-live="polite">{message}</small>
    </div>
  );
}
