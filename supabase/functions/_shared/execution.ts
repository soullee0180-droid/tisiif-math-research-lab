import {
  assembleResearch,
  parseResearch,
  mockResearch,
} from "../../../packages/contracts/research.ts";
import { prepareFile, finishFile } from "./provider-files.ts";
import {
  assemble,
  parse,
  mock,
  stable,
  sha,
  type Json,
  type Stage,
  type Provider,
  anonymize,
  executionBundle,
  executionVersion,
  enc,
} from "../../../packages/contracts/core.ts";
import { type Runtime, crypt, rawStore, safeError } from "./runtime.ts";
import {
  wire,
  send,
  extract,
  classify,
  cost,
  termination,
} from "./providers.ts";
export async function assembled(rt: Runtime, attempt: string) {
  const c = await rt.rpc("lab_context", { attempt });
  if (!c) throw Error("NOT_FOUND");
  if (c.plan.protocol.execution_bundle?.version !== executionVersion)
    throw Error("EXECUTION_VERSION_UNSUPPORTED");
  return {
    c,
    request:
      c.job.stage === "research"
        ? await assembleResearch(c)
        : await assemble(
            c.run.original_id || c.run.id,
            c.job.stage,
            c.job.provider,
            c.plan.k,
            c.revision,
            c.ideas,
            c.plan.protocol.stage_prompts || {},
            {
              reveal_generator_identity:
                c.plan.protocol.reveal_generator_identity === true,
              generator: c.run.generator,
            },
            c.plan.protocol.execution_bundle || executionBundle(),
          ),
  };
}
function responseMetadata(c: Json, raw: string, extra: Json = {}) {
  const data = JSON.parse(raw),
    out = extract(c.job.provider, data);
  return {
    output: out.output,
    metadata: {
      returned_model: out.model,
      remote_id: out.remote_id,
      usage: out.usage,
      ...cost(c.model, out.usage, c.job.provider),
      termination: termination(c.job.provider, data),
      ...extra,
    },
  };
}
async function complete(
  rt: Runtime,
  attempt: string,
  c: Json,
  output: string,
  metadata: Json = {},
) {
  const parsed =
    c.job.stage === "research"
      ? parseResearch(
          c.revision.task_type,
          output,
          c.attempt.request_snapshot?.schema ||
            c.plan.protocol.research_bundle.schemas[c.revision.task_type],
        )
      : parse(
          c.job.stage,
          output,
          c.plan.k,
          c.attempt.request_snapshot?.schema,
        );
  const diff =
    c.job.stage === "generate"
      ? parsed.ideas.map((i: Json) => ({
          candidate_id: i.candidate_id,
          title: anonymize(i.title).diff,
          idea_md: anonymize(i.idea_md).diff,
        }))
      : null;
  await rt.rpc("lab_attempt", {
    attempt,
    command: "complete",
    p: { parsed, metadata, anonymization_diff: diff },
  });
  if (c.plan.protocol.smoke_profile_id)
    await rt.rpc("lab_smoke_result", { attempt });
  return parsed;
}
export async function execute(rt: Runtime, attempt: string) {
  let sent = false,
    stored = false;
  const start = Date.now();
  const timer = setInterval(() => {
    void rt.rpc("lab_heartbeat", { attempt }).catch(() => {});
  }, 15000);
  try {
    const data = await assembled(rt, attempt);
    const c: Json = data.c;
    const request = data.request;
    if (c.attempt.completed_at) return;
    const isMock = c.plan.transport === "mock";
    if (!isMock && c.plan.transport !== "api") throw Error("WRONG_TRANSPORT");
    // PDF inference is admitted only after separate file preparation and capability evidence.
    let remoteFile: Json | undefined;
    if (!isMock && c.revision.input_mode === "pdf") {
      if (!c.secret?.encrypted) throw Error("credential_blocked");
      const fileContext = await rt.rpc("lab_file_context", { attempt });
      if (!fileContext?.asset) throw Error("PREPARED_NOT_VERIFIED");
      if (
        fileContext.file?.state === "ready" &&
        Date.parse(fileContext.file.last_verified_at) > Date.now() - 900000
      )
        remoteFile = fileContext.file;
      else {
        await prepareFile(rt, attempt, c, fileContext);
        const after = await rt.rpc("lab_context", { attempt });
        if (
          ["blocked", "parse_failed", "unknown_remote"].includes(
            after?.job?.status,
          )
        )
          await rt.rpc("lab_smoke_result", { attempt });
        return;
      }
    }
    const w = isMock
      ? {
          url: "mock://fixture-v3",
          headers: {},
          body: request,
          bodyText: stable(request),
        }
      : wire(c.job.provider, c.model, request, remoteFile);
    const asset = await rawStore(rt, attempt, w.bodyText, "request");
    await rt.rpc("lab_attempt", {
      attempt,
      command: "request",
      p: {
        asset_id: asset.id,
        snapshot: {
          ...request,
          wire: {
            url: w.url,
            headers: w.headers,
            body_hash: await sha(w.bodyText),
          },
          protocol_hash: await sha(stable(c.plan.protocol)),
          key_version: c.secret?.key_version || null,
        },
      },
    });
    if (isMock) {
      const raw = stable(
        c.job.stage === "research"
          ? mockResearch(c.revision.task_type)
          : mock(c.job.stage, c.plan.k),
      );
      const response = await rawStore(rt, attempt, raw, "response");
      await rt.rpc("lab_attempt", {
        attempt,
        command: "response",
        p: {
          asset_id: response.id,
          sha256: response.sha256,
          metadata: { fixture: true },
        },
      });
      stored = true;
      c.attempt.request_snapshot = request;
      await complete(rt, attempt, c, raw, {
        fixture: true,
        cost_usd: 0,
        total_tokens: 0,
        elapsed_ms: Date.now() - start,
      });
      return;
    }
    if (!c.secret?.encrypted) throw Error("credential_blocked");
    const key = (await crypt(
      rt,
      c.job.workspace_id,
      c.job.provider,
      c.secret.encrypted,
      true,
    )) as string;
    await rt.rpc("lab_admit_request", {
      attempt,
      input_bytes: enc.encode(w.bodyText).length,
      pdf_pages:
        c.revision.input_mode === "pdf"
          ? (c.revision.page_recipe || []).filter((p: Json) => p.include).length
          : 0,
    });
    await rt.rpc("lab_attempt", { attempt, command: "send", p: {} });
    sent = true;
    const result = await send(rt, c.job.provider, w, key);
    const response = await rawStore(rt, attempt, result.raw, "response");
    await rt.rpc("lab_attempt", {
      attempt,
      command: "response",
      p: {
        asset_id: response.id,
        sha256: response.sha256,
        metadata: {
          http_status: result.status,
          request_id: result.request_id,
          raw_complete: true,
        },
      },
    });
    stored = true;
    if (!result.ok) {
      await rt.rpc("lab_attempt", {
        attempt,
        command: "fail",
        p: {
          ...classify(result.status, result.raw, result.retryAfter),
          http_status: result.status,
          elapsed_ms: Date.now() - start,
        },
      });
      await rt.rpc("lab_smoke_result", { attempt });
      return;
    }
    const out = responseMetadata(c, result.raw, {
      request_id: result.request_id,
      elapsed_ms: Date.now() - start,
    });
    await rt.rpc("lab_settle_usage", { attempt, metadata: out.metadata });
    if (!out.metadata.termination.complete) {
      await rt.rpc("lab_attempt", {
        attempt,
        command: "fail",
        p: {
          class: "model_or_input",
          code: out.metadata.termination.refused
            ? "MODEL_REFUSAL"
            : "INCOMPLETE_OUTPUT",
        },
      });
      await rt.rpc("lab_smoke_result", { attempt });
      return;
    }
    c.attempt.request_snapshot = request;
    await complete(rt, attempt, c, out.output, out.metadata);
  } catch (error) {
    const durable = await rt.rpc("lab_context", { attempt }).catch(() => null);
    sent = sent || !!durable?.attempt.send_started_at;
    stored = stored || !!durable?.attempt.response_asset_id;
    await rt
      .rpc("lab_attempt", {
        attempt,
        command: "fail",
        p: {
          class: stored
            ? "parse_failed"
            : sent
              ? "unknown_remote"
              : safeError(error) === "credential_blocked"
                ? "credential_blocked"
                : "model_or_input",
          code: safeError(error),
          raw_stored: stored,
        },
      })
      .catch(() => {});
    await rt.rpc("lab_smoke_result", { attempt }).catch(() => {});
  } finally {
    clearInterval(timer);
  }
}
export async function reparse(rt: Runtime, attempt: string) {
  const { c } = await assembled(rt, attempt);
  if (c.attempt.completed_at) return { complete: true };
  if (!c.attempt.response_asset_id) throw Error("STORED_RAW_REQUIRED");
  await rt.rpc("lab_attempt", { attempt, command: "reparse_begin", p: {} });
  try {
    const asset = await rt.rpc("lab_asset", {
      w: c.job.workspace_id,
      a: c.plan.created_by,
      asset_id: c.attempt.response_asset_id,
    });
    const bytes = await rt.get("raw", asset.path);
    if ((await sha(bytes)) !== c.attempt.response_hash)
      throw Error("RAW_HASH_MISMATCH");
    const raw = new TextDecoder().decode(bytes);
    if (c.attempt.request_snapshot.kind === "file_preparation")
      return finishFile(rt, attempt, c, raw);
    let output = raw,
      metadata: Json = { reparsed_without_model_call: true };
    if (c.plan.transport === "api") {
      if (
        c.attempt.metadata.http_status < 200 ||
        c.attempt.metadata.http_status >= 300
      )
        throw Error("HTTP_ERROR_NOT_REPARSEABLE");
      const out = responseMetadata(c, raw, {
        request_id: c.attempt.metadata.request_id,
        elapsed_ms:
          c.attempt.metadata.elapsed_ms ??
          Date.parse(c.attempt.response_stored_at) -
            Date.parse(c.attempt.send_started_at),
        reparsed_without_model_call: true,
      });
      output = out.output;
      metadata = out.metadata;
      await rt.rpc("lab_settle_usage", { attempt, metadata });
      if (!metadata.termination.complete) throw Error("INCOMPLETE_OUTPUT");
    } else if (c.plan.transport === "manual_web") {
      const d = JSON.parse(raw);
      output = d.corrected_json ? JSON.stringify(d.corrected_json) : d.raw;
      metadata = { ...d.metadata, ...metadata };
    }
    return await complete(rt, attempt, c, output, metadata);
  } catch (e) {
    await rt.rpc("lab_attempt", {
      attempt,
      command: "fail",
      p: { class: "parse_failed", code: safeError(e) },
    });
    await rt.rpc("lab_smoke_result", { attempt });
    throw e;
  }
}
export async function manualPrompt(
  rt: Runtime,
  w: string,
  a: string,
  job: string,
) {
  const attempt = await rt.rpc("lab_manual_begin", { w, a, job });
  const { c, request } = await assembled(rt, attempt);
  if (!c.attempt.request_asset_id) {
    const asset = await rawStore(rt, attempt, stable(request), "request");
    await rt.rpc("lab_attempt", {
      attempt,
      command: "request",
      p: { asset_id: asset.id, snapshot: request },
    });
  }
  return {
    attempt_id: attempt,
    system: request.system,
    prompt: request.prompt,
    schema: request.schema,
    mapping: request.mapping,
    prepared_asset_id: request.dto.public_context.prepared_asset?.id,
    complete: !!c.attempt.completed_at,
    original_raw: c.attempt.response_asset_id
      ? JSON.parse(
          new TextDecoder().decode(
            await rt.get(
              "raw",
              (
                await rt.rpc("lab_asset", {
                  w,
                  a,
                  asset_id: c.attempt.response_asset_id,
                })
              ).path,
            ),
          ),
        ).raw
      : null,
  };
}
export async function manualSubmit(
  rt: Runtime,
  w: string,
  a: string,
  attempt: string,
  p: Json,
) {
  await rt.rpc("lab_authorize_attempt", { w, a, attempt });
  let { c } = await assembled(rt, attempt);
  if (c.plan.transport !== "manual_web") throw Error("WRONG_TRANSPORT");
  if (p.human_corrected && !p.corrected_json)
    throw Error("CORRECTED_JSON_REQUIRED");
  const metadata = {
    model: p.model || null,
    mode: p.mode || null,
    actual_at: p.actual_at || null,
    tools: p.tools ?? null,
    search: p.search ?? null,
    memory: p.memory ?? null,
    human_corrected: !!p.human_corrected,
  };
  const raw = stable({
    raw: p.raw,
    corrected_json: p.human_corrected ? p.corrected_json : null,
    metadata,
    mapping: c.attempt.request_snapshot.mapping,
  });
  const hash = await sha(raw);
  if (c.attempt.completed_at) {
    if (c.attempt.response_hash !== hash) throw Error("IMMUTABLE_RAW_RESPONSE");
    return { complete: true };
  }
  if (c.attempt.response_asset_id && c.attempt.response_hash !== hash) {
    if (!p.human_corrected) throw Error("RAW_CONFLICT_USE_CORRECTION");
    const old = await rt.rpc("lab_asset", {
      w,
      a,
      asset_id: c.attempt.response_asset_id,
    });
    const original = JSON.parse(
      new TextDecoder().decode(await rt.get("raw", old.path)),
    );
    if (original.raw !== p.raw) throw Error("ORIGINAL_RAW_MUST_BE_PRESERVED");
    attempt = await rt.rpc("lab_manual_correction", {
      w,
      a,
      old_attempt: attempt,
    });
    c = (await assembled(rt, attempt)).c;
  }
  if (!c.attempt.response_asset_id) {
    const asset = await rawStore(rt, attempt, raw, "response");
    await rt.rpc("lab_attempt", {
      attempt,
      command: "response",
      p: { asset_id: asset.id, sha256: asset.sha256, metadata },
    });
  }
  try {
    return await complete(
      rt,
      attempt,
      c,
      p.human_corrected ? JSON.stringify(p.corrected_json) : p.raw,
      metadata,
    );
  } catch (e) {
    await rt.rpc("lab_attempt", {
      attempt,
      command: "fail",
      p: { class: "parse_failed", code: safeError(e) },
    });
    throw e;
  }
}
