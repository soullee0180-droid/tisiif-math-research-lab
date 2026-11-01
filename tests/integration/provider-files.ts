import assert from "node:assert/strict";
import { fixture } from "./fixture";
import { execute } from "../../supabase/functions/_shared/execution";
import { crypt } from "../../supabase/functions/_shared/runtime";
import { providers, enc, sha, mock } from "../../packages/contracts/core";
const f = await fixture();
const paper = await f.write("paper_create", {
    title: "Synthetic PDF adapter fixture",
  }),
  bytes = enc.encode("%PDF synthetic adapter-only bytes"),
  hash = await sha(bytes);
const recipe = [{ page: 1, include: true, rotation: 0, masks: [] }];
const source = await f.write("asset_reserve", {
  paper_id: paper.id,
  kind: "source",
  bytes: bytes.length,
  sha256: hash,
});
await f.write("asset_verified", { id: source.id });
const asset = await f.write("asset_reserve", {
  paper_id: paper.id,
  kind: "prepared",
  bytes: bytes.length,
  sha256: hash,
});
await f.rt.put("prepared", asset.path, bytes, "application/pdf");
await f.write("asset_verified", {
  id: asset.id,
  server_hash: true,
  metadata: {
    preparation: {
      source_asset_id: source.id,
      source_sha256: hash,
      page_recipe: recipe,
    },
    server_inspection: {
      status: "PASS",
      scope: "synthetic adapter fixture only",
    },
    preview_sha256: hash,
    inspection: {
      status: "PASS",
      source: "synthetic_adapter_fixture",
      pages: 1,
    },
  },
});
const cp = await f.write("checkpoint_create", {
  paper_id: paper.id,
  title: "PDF adapter-only checkpoint",
  body: {
    input_mode: "pdf",
    source_asset_id: source.id,
    goal: "Synthetic adapter goal",
    obstacle: "Synthetic obstacle",
    reference_idea_md: "HIDDEN_REFERENCE",
    reference_location: "fixture only",
    prepared_asset_id: asset.id,
    prepared_sha256: hash,
    steps: [],
    page_recipe: [{ page: 1, include: true, rotation: 0, masks: [] }],
  },
});
await f.write("revision_approve", {
  id: cp.id,
  if_match: 1,
  checks: [true, true, true],
});
await f.write("workspace_settings", {
  api_enabled: true,
  scheduler_enabled: false,
  app_origin: "https://fixture.invalid",
});
const seen: string[] = [];
const rt = {
  ...f.rt,
  fetch: async (input: any, init: any) => {
    const url = String(input);
    seen.push(url);
    if (url === "https://generativelanguage.googleapis.com/upload/v1beta/files")
      return new Response("{}", {
        headers: {
          "x-goog-upload-url":
            "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=sensitive-upload-token",
        },
      });
    if (url.includes("upload_id="))
      return Response.json({
        file: {
          uri: "https://generativelanguage.googleapis.com/v1beta/files/fixture",
          state: "ACTIVE",
          expirationTime: "2099-01-01T00:00:00Z",
        },
      });
    if (url === "https://api.openai.com/v1/files")
      return Response.json({ id: "file-fixture", status: "processed" });
    if (url === "https://api.anthropic.com/v1/files")
      return Response.json({ id: "file_fixture" });
    const output = JSON.stringify(mock("generate", 1));
    if (url === "https://api.openai.com/v1/responses")
      return Response.json({
        id: "resp-fixture",
        status: "completed",
        model: "fixture-model",
        usage: { input_tokens: 2, output_tokens: 3 },
        output: [{ content: [{ type: "output_text", text: output }] }],
      });
    if (url === "https://api.anthropic.com/v1/messages")
      return Response.json({
        id: "msg-fixture",
        stop_reason: "end_turn",
        model: "fixture-model",
        usage: { input_tokens: 2, output_tokens: 3 },
        content: [{ type: "text", text: output }],
      });
    if (url.endsWith(":generateContent"))
      return Response.json({
        responseId: "google-fixture",
        modelVersion: "fixture-model",
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: output }] } },
        ],
      });
    throw Error("UNEXPECTED_FIXTURE_HTTP");
  },
};
for (const provider of providers) {
  await f.write("key_store", {
    provider,
    encrypted: await crypt(f.rt, f.w, provider, "synthetic-api-key"),
    last_four: "-key",
    request_hash: hash,
  });
  await f.write("budget_save", {
    provider,
    enabled: true,
    budget_usd: 10,
    org_verified: true,
  });
  const model = await f.write("model_save", {
    provider,
    model_id: "fixture-model",
    api_family:
      provider === "google"
        ? "generate_content"
        : provider === "openai"
          ? "responses"
          : "messages",
    parameters: {},
    output_cap: 1024,
    pricing: {
      input_per_million: 1,
      output_per_million: 1,
      max_request_usd: 1,
    },
  });
  const probe = await f.call("lab_smoke_begin", {
    w: f.w,
    a: f.a,
    profile: model.id,
    revision: cp.id,
    probe_stage: "generate",
  });
  let job = await f.call("lab_claim", { provider_name: provider });
  assert.ok(job);
  await execute(rt, job.attempt_id);
  const prep = await f.call("lab_context", { attempt: job.attempt_id });
  assert.equal(prep.attempt.milestone, "file_prepared");
  assert.equal(prep.job.status, "queued");
  await f.db.query("update lab.jobs set due_at=now() where id=$1", [
    job.job_id,
  ]);
  job = await f.call("lab_claim", { provider_name: provider });
  await execute(rt, job.attempt_id);
  const complete = await f.call("lab_context", { attempt: job.attempt_id });
  assert.equal(complete.job.status, "complete");
  const profile = (
    await f.db.query(
      "select capabilities from lab.model_profiles where id=$1",
      [model.id],
    )
  ).rows[0] as any;
  assert.equal(profile.capabilities.pdf_stages.generate.status, "PASS");
  assert.equal(profile.capabilities.text ?? "NOT_RUN", "NOT_RUN");
}
for (const bytes of f.objects.values()) {
  const text = new TextDecoder().decode(bytes);
  assert.ok(!text.includes("synthetic-api-key"));
  assert.ok(!text.includes("sensitive-upload-token"));
}
assert.equal(seen.length, 7);
console.log(
  "PASS three official file adapters through mocked HTTP: separate file preparation, durable remote handles, exact wire manifest, budget release, PDF diagnostic inference, no key/upload-token leak. Real provider calls: 0.",
);
await f.db.close();
