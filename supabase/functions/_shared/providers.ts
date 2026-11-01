import {
  type Json,
  type Provider,
  stable,
  enc,
} from "../../../packages/contracts/core.ts";
import type { Runtime } from "./runtime.ts";
export function classify(
  status: number,
  body: string,
  retryAfter: string | null = null,
) {
  const text = body.toLowerCase();
  let kind = "model_or_input",
    safe = false;
  if (status === 402) kind = "payment_blocked";
  else if (status === 401) kind = "credential_blocked";
  else if (status === 403) kind = "permission_blocked";
  else if (status === 413) kind = "input_size";
  else if (status === 429) {
    kind = /billing|credit|spend|payment|insufficient_quota/.test(text)
      ? "spend_blocked"
      : /daily|per.day/.test(text)
        ? "quota_daily"
        : /rate.limit|requests.per.minute|tokens.per.minute|resource_exhausted/.test(
              text,
            ) && !(/quota/.test(text) && !/per.minute/.test(text))
          ? "rate_transient"
          : "quota_unknown";
    safe = kind === "rate_transient";
  } else if (status >= 500) kind = "unknown_remote";
  const seconds = Number(retryAfter);
  return {
    class: kind,
    safe_rejection: safe,
    confirmed_rejection: [400, 401, 402, 403, 404, 413, 422, 429].includes(
      status,
    ),
    retry_after: retryAfter
      ? Number.isFinite(seconds)
        ? new Date(Date.now() + seconds * 1000).toISOString()
        : Number.isFinite(Date.parse(retryAfter))
          ? new Date(retryAfter).toISOString()
          : null
      : null,
  };
}
export function providerSchema(v: any, provider: Provider): any {
  if (Array.isArray(v)) return v.map((x) => providerSchema(x, provider));
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(
        ([k]) =>
          k !== "$schema" &&
          !(
            provider === "anthropic" &&
            ["minimum", "maximum", "minItems", "maxItems"].includes(k)
          ),
      )
      .map(([k, x]) => [k, providerSchema(x, provider)]),
  );
}
// Core request fields are never user-extensible. Nested settings are validated too.
export const parameterAllowlist: Record<Provider, string[]> = {
  openai: ["temperature", "top_p", "reasoning"],
  anthropic: ["temperature", "top_p", "top_k", "thinking"],
  google: ["temperature", "topP", "topK", "thinkingConfig"],
};
export function validateParameters(provider: Provider, params: Json = {}) {
  if (!params || Array.isArray(params) || typeof params !== "object")
    throw Error("MODEL_PARAMETERS_INVALID");
  for (const [key, value] of Object.entries(params)) {
    if (!parameterAllowlist[provider]?.includes(key))
      throw Error("UNVALIDATED_MODEL_PARAMETER");
    if (typeof value === "object") {
      const keys =
        key === "reasoning"
          ? ["effort", "summary"]
          : key === "thinking"
            ? ["type", "budget_tokens"]
            : key === "thinkingConfig"
              ? ["thinkingBudget", "thinkingLevel", "includeThoughts"]
              : [];
      if (
        !value ||
        Array.isArray(value) ||
        Object.keys(value).some((k) => !keys.includes(k))
      )
        throw Error("UNVALIDATED_MODEL_PARAMETER");
    } else if (!Number.isFinite(value) || value < 0)
      throw Error("MODEL_PARAMETERS_INVALID");
  }
  return params;
}
export function wire(
  provider: Provider,
  model: Json,
  assembled: Json,
  remoteFile?: Json,
) {
  validateParameters(provider, model.parameters || {});
  const s = providerSchema(assembled.schema, provider);
  const optional: Json = {};
  const allowed = parameterAllowlist[provider];
  for (const [k, v] of Object.entries(model.parameters || {})) {
    if (!allowed.includes(k)) throw Error("UNVALIDATED_MODEL_PARAMETER");
    optional[k] = v;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let url = "",
    body: Json;
  if (provider === "openai") {
    if (model.api_family !== "responses") throw Error("API_FAMILY");
    url = "https://api.openai.com/v1/responses";
    const content: Json[] = [{ type: "input_text", text: assembled.prompt }];
    if (remoteFile)
      content.unshift({ type: "input_file", file_id: remoteFile.remote_id });
    body = {
      model: model.model_id,
      instructions: assembled.system,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "tisiif",
          strict: true,
          schema: s,
        },
      },
      tools: [],
      store: false,
      max_output_tokens: model.output_cap,
      ...optional,
    };
  } else if (provider === "anthropic") {
    if (model.api_family !== "messages") throw Error("API_FAMILY");
    url = "https://api.anthropic.com/v1/messages";
    headers["anthropic-version"] = "2023-06-01";
    const content: Json[] = [{ type: "text", text: assembled.prompt }];
    if (remoteFile) {
      content.unshift({
        type: "document",
        source: { type: "file", file_id: remoteFile.remote_id },
      });
      headers["anthropic-beta"] = "files-api-2025-04-14";
    }
    body = {
      model: model.model_id,
      system: assembled.system,
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: s } },
      max_tokens: model.output_cap,
      ...optional,
    };
  } else {
    if (model.api_family !== "generate_content") throw Error("API_FAMILY");
    url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model.model_id) +
      ":generateContent";
    const parts: Json[] = [{ text: assembled.prompt }];
    if (remoteFile)
      parts.unshift({
        fileData: {
          mimeType: "application/pdf",
          fileUri: remoteFile.remote_id,
        },
      });
    body = {
      systemInstruction: { parts: [{ text: assembled.system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        maxOutputTokens: model.output_cap,
        responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: s } },
        ...optional,
      },
      tools: [],
    };
  }
  return { url, headers, body, bodyText: stable(body) };
}
export async function readLimited(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > 1048576) {
      await reader.cancel();
      throw Error("RAW_TOO_LARGE");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const v of chunks) {
    out.set(v, at);
    at += v.length;
  }
  return new TextDecoder().decode(out);
}
export function extract(provider: Provider, data: Json) {
  if (provider === "openai")
    return {
      output: (data.output || [])
        .flatMap((o: Json) => o.content || [])
        .filter((c: Json) => c.type === "output_text")
        .map((c: Json) => c.text)
        .join(""),
      model: data.model || null,
      usage: data.usage || null,
      remote_id: data.id || null,
    };
  if (provider === "anthropic")
    return {
      output: (data.content || [])
        .filter((c: Json) => c.type === "text")
        .map((c: Json) => c.text)
        .join(""),
      model: data.model || null,
      usage: data.usage || null,
      remote_id: data.id || null,
    };
  return {
    output: (data.candidates?.[0]?.content?.parts || [])
      .filter((c: Json) => !c.thought)
      .map((c: Json) => c.text || "")
      .join(""),
    model: data.modelVersion || null,
    usage: data.usageMetadata || null,
    remote_id: data.responseId || null,
  };
}
export async function send(
  rt: Runtime,
  provider: Provider,
  request: ReturnType<typeof wire>,
  key: string,
) {
  const headers = { ...request.headers };
  if (provider === "openai") headers.Authorization = "Bearer " + key;
  else if (provider === "anthropic") headers["x-api-key"] = key;
  else headers["x-goog-api-key"] = key;
  const response = await rt.fetch(request.url, {
    method: "POST",
    headers,
    body: request.bodyText,
    signal: AbortSignal.timeout(100000),
  });
  return {
    status: response.status,
    ok: response.ok,
    raw: await readLimited(response),
    retryAfter: response.headers.get("retry-after"),
    request_id:
      response.headers.get("x-request-id") ||
      response.headers.get("request-id") ||
      null,
  };
}
// Cache prices are explicit: never silently invent a price or count missing usage as zero.
export function cost(model: Json, usage: Json | null, provider: Provider) {
  if (!usage) return { total_tokens: null, cost_usd: null };
  const number = (x: any) => (Number.isFinite(x) && x >= 0 ? x : null);
  const input = number(
    provider === "google" ? usage.promptTokenCount : usage.input_tokens,
  );
  const visible = number(
    provider === "google" ? usage.candidatesTokenCount : usage.output_tokens,
  );
  const thoughts =
    provider === "google" ? number(usage.thoughtsTokenCount) || 0 : 0;
  const cached =
    number(
      provider === "google"
        ? usage.cachedContentTokenCount
        : provider === "anthropic"
          ? usage.cache_read_input_tokens
          : usage.input_tokens_details?.cached_tokens,
    ) || 0;
  const creation =
    provider === "anthropic"
      ? number(usage.cache_creation_input_tokens) || 0
      : number(usage.input_tokens_details?.cache_write_tokens) || 0;
  if (input === null || visible === null)
    return {
      total_tokens: number(usage.totalTokenCount ?? usage.total_tokens),
      cost_usd: null,
    };
  const output = visible + thoughts,
    p = model.pricing || {};
  const full = provider === "anthropic" ? input : input - cached - creation;
  const components: Json = {
    input_tokens: full,
    output_tokens: output,
    cached_tokens: cached,
    cache_write_tokens: creation,
    reasoning_tokens:
      thoughts || usage.output_tokens_details?.reasoning_tokens || 0,
  };
  const total =
    provider === "anthropic"
      ? input + cached + creation + output
      : input + output;
  const total_tokens =
    number(usage.totalTokenCount ?? usage.total_tokens) ?? total;
  let dollars = 0,
    known = full >= 0;
  const charge = (tokens: number, price: any) => {
    if (tokens > 0) {
      if (number(price) === null) known = false;
      else dollars += (tokens * price) / 1e6;
    }
  };
  charge(full, p.input_per_million);
  charge(output, p.output_per_million);
  charge(cached, p.cache_read_per_million);
  if (provider === "anthropic" && usage.cache_creation) {
    const five = number(usage.cache_creation.ephemeral_5m_input_tokens) || 0,
      hour = number(usage.cache_creation.ephemeral_1h_input_tokens) || 0;
    charge(five, p.cache_write_5m_per_million);
    charge(hour, p.cache_write_1h_per_million);
    charge(Math.max(0, creation - five - hour), p.cache_write_per_million);
  } else charge(creation, p.cache_write_per_million);
  if ((usage.toolUsePromptTokenCount || 0) > 0) known = false;
  return {
    total_tokens,
    cost_usd: known ? dollars : null,
    billing_components: components,
    pricing_status: known ? "calculated" : "missing_rate_or_usage",
  };
}
export function termination(provider: Provider, data: Json) {
  const reason =
    provider === "openai"
      ? data.status
      : provider === "anthropic"
        ? data.stop_reason
        : data.candidates?.[0]?.finishReason;
  const refused =
    provider === "openai"
      ? (data.output || []).some((o: Json) =>
          (o.content || []).some((c: Json) => c.type === "refusal"),
        )
      : provider === "anthropic"
        ? reason === "refusal"
        : !!data.promptFeedback?.blockReason ||
          ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "RECITATION"].includes(
            reason,
          );
  const complete =
    !refused &&
    (provider === "openai"
      ? reason === "completed"
      : provider === "anthropic"
        ? reason === "end_turn"
        : reason === "STOP");
  return {
    complete,
    reason: reason || "missing_finish_reason",
    refused,
    details: data.incomplete_details || data.promptFeedback || null,
  };
}
