// Test-only HTTP bridge to real PostgreSQL RPC functions. Never publish this server.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
await db.exec("create role anon; create role authenticated;");
await db.exec(
  await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
);
await db.exec("set role anon;");
const signatures = {
  pro_create: ["p_id", "p_admin_token", "p_edit_token", "p_document"],
  pro_read: ["p_id", "p_token"],
  pro_apply: ["p_id", "p_token", "p_operation"],
  pro_manage: ["p_id", "p_token", "p_action", "p_edit_token"],
};
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:5174");
  response.setHeader("Access-Control-Allow-Headers", "content-type,apikey");
  response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS" || request.url === "/health")
    return response.end("{}");
  const name = request.url?.split("/").pop();
  if (!(name in signatures)) {
    response.statusCode = 404;
    return response.end("{}");
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const params = signatures[name].map((key) =>
      typeof body[key] === "object" && body[key] !== null
        ? JSON.stringify(body[key])
        : (body[key] ?? null),
    );
    const result = await db.query(
      `select public.${name}(${params.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      params,
    );
    response.end(JSON.stringify(result.rows[0].result));
  } catch (error) {
    response.statusCode = 400;
    response.end(JSON.stringify({ message: error.message }));
  }
});
server.listen(7788, "127.0.0.1");
const stop = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
