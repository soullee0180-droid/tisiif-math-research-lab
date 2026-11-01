import { runtime } from "../_shared/runtime.ts";
import { internalAuth } from "../_shared/internal-auth.ts";
import { dispatch } from "../_shared/dispatch.ts";
const rt = runtime();
Deno.serve(async (req) => {
  try {
    const body = await req.text();
    await internalAuth(rt, req, body);
  } catch {
    return Response.json({ error: "DISPATCH_REJECTED" }, { status: 403 });
  }
  try {
    const result = await dispatch(rt);
    return Response.json(result, { status: result.ok ? 200 : 207 });
  } catch {
    return Response.json({ error: "DISPATCH_FAILED" }, { status: 500 });
  }
});
