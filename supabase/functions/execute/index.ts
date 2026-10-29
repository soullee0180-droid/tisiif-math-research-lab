declare const EdgeRuntime: { waitUntil: (task: Promise<unknown>) => void };
import { runtime } from "../_shared/runtime.ts";
import { internalAuth } from "../_shared/internal-auth.ts";
import { execute } from "../_shared/execution.ts";
const rt = runtime();
Deno.serve(async (req) => {
  try {
    const body = await req.text();
    await internalAuth(rt, req, body);
    const p = JSON.parse(body);
    if (typeof p.attempt_id !== "string") throw Error();
    EdgeRuntime.waitUntil(execute(rt, p.attempt_id));
    return Response.json({ accepted: true }, { status: 202 });
  } catch {
    return Response.json({ error: "INTERNAL_AUTH_OR_INPUT" }, { status: 403 });
  }
});
