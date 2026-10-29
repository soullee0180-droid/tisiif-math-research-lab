import { providers, type Json } from "../../../packages/contracts/core.ts";
import { type Runtime, safeError } from "./runtime.ts";
import { signed } from "./internal-auth.ts";
export async function dispatch(rt: Runtime) {
  await rt.rpc("lab_recover", {});
  const results: Json[] = [];
  for (const provider of providers) {
    let attempt: string | undefined;
    try {
      const claim = await rt.rpc("lab_claim", { provider_name: provider });
      if (!claim) {
        results.push({ provider, status: "idle" });
        continue;
      }
      attempt = claim.attempt_id;
      const path = "/functions/v1/execute",
        body = JSON.stringify({ attempt_id: attempt });
      const r = await rt.fetch(rt.env("SUPABASE_URL") + path, {
        method: "POST",
        headers: await signed(rt, path, body),
        body,
        signal: AbortSignal.timeout(5000),
      });
      results.push({
        provider,
        attempt_id: attempt,
        status: r.ok ? "accepted" : "dispatch_failed",
        http_status: r.status,
      });
      if (!r.ok)
        await rt.rpc("lab_dispatch_event", {
          attempt,
          detail: { http_status: r.status, error: "DISPATCH_HTTP_ERROR" },
        });
    } catch (e) {
      results.push({
        provider,
        attempt_id: attempt,
        status: "dispatch_unknown",
        error: safeError(e),
      });
      if (attempt)
        await rt
          .rpc("lab_dispatch_event", {
            attempt,
            detail: { error: safeError(e) },
          })
          .catch(() => {});
    }
  }
  return {
    ok: results.every(
      (r) => !["dispatch_failed", "dispatch_unknown"].includes(r.status),
    ),
    results,
  };
}
