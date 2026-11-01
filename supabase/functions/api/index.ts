import { runtime } from "../_shared/runtime.ts";
import { handler } from "./handler.ts";
const rt = runtime();
Deno.serve((req) => handler(req, rt));
