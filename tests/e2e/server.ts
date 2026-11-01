// Isolated CI fixture server. Never imported or bundled by production entrypoints.
import http from "node:http";
import fs from "node:fs/promises";
import { fixture } from "../integration/fixture";
import { handler } from "../../supabase/functions/api/handler";
const f = await fixture();
await f.db.query(
  'update lab.workspaces set settings=settings||\'{"access_mode":"public"}\'::jsonb where id=$1',
  [f.w],
);
await f.db.query(
  "insert into lab.members(workspace_id,id,id_email,role) values($1,$2,'public@lab.invalid','researcher')",
  [f.w, crypto.randomUUID()],
);
const testRt = {
  ...f.rt,
  download: async (bucket: string, path: string) =>
    "http://127.0.0.1:4174/__fixture_asset?key=" +
    encodeURIComponent(bucket + "/" + path),
};
const source = await fs.readFile("tests/e2e/pdf.html", "utf8");
await fs.writeFile("apps/web/__pdf.html", source);
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      res.end("ok");
      return;
    }
    if (req.url?.startsWith("/__fixture_asset?")) {
      const key = new URL(req.url, "http://127.0.0.1:4174").searchParams.get(
        "key",
      )!;
      const bytes = f.objects.get(key);
      res.writeHead(bytes ? 200 : 404, { "Access-Control-Allow-Origin": "*" });
      res.end(bytes ? Buffer.from(bytes) : "NOT_FOUND");
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const r = await handler(
      new Request("http://127.0.0.1:4174" + req.url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method === "POST" ? body : undefined,
      }),
      testRt,
    );
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end("TEST_SERVER_ERROR");
  }
});
server.listen(4174, "127.0.0.1", () => console.log("Fixture API ready"));
process.on("SIGTERM", () => {
  server.close();
  void f.db.close().then(() => process.exit());
});
