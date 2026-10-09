// Test-only HTTP bridge to real PostgreSQL RPC functions. Never publish this server.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createHandler } from "../supabase/functions/checklist-files/handler.ts";
const db = new PGlite();
await db.exec(
  "create role anon; create role authenticated; create role service_role;",
);
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
const serviceSignatures = {
  ...signatures,
  pro_file: ["p_id", "p_token", "p_action", "p_file"],
  pro_file_cleanup: ["p_ids"],
};
const objects = new Map();
const downloads = new Map();
const filesHandler = createHandler({
  url: "http://127.0.0.1:7788",
  serviceKey: "test-server-only",
  cleanupSecret: "test-cleanup",
  fetch: async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/rest/v1/rpc/")) {
      const name = parsed.pathname.split("/").pop();
      await db.exec("reset role; set role service_role;");
      try {
        const body = JSON.parse(options.body);
        const params = serviceSignatures[name].map((key) =>
          typeof body[key] === "object" && body[key] !== null && key !== "p_ids"
            ? JSON.stringify(body[key])
            : (body[key] ?? null),
        );
        const result = await db.query(
          `select public.${name}(${params.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
          params,
        );
        return Response.json(result.rows[0].result);
      } catch (error) {
        return Response.json({ message: error.message }, { status: 400 });
      } finally {
        await db.exec("reset role; set role anon;");
      }
    }
    if (parsed.pathname.startsWith("/storage/v1/object/sign/")) {
      const path = parsed.pathname.replace(
        "/storage/v1/object/sign/checklist-attachments/",
        "",
      );
      if (!objects.has(path)) return Response.json({}, { status: 404 });
      const token = crypto.randomUUID();
      downloads.set(token, path);
      return Response.json({
        signedURL: `/object/sign/checklist-attachments/${path}?token=${token}`,
      });
    }
    if (options.method === "DELETE") {
      const { prefixes } = JSON.parse(options.body);
      for (const path of prefixes) objects.delete(path);
      return Response.json({});
    }
    const path = parsed.pathname.replace(
      "/storage/v1/object/checklist-attachments/",
      "",
    );
    objects.set(path, Buffer.from(options.body));
    return Response.json({});
  },
});
async function handle(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:5174");
  response.setHeader("Access-Control-Allow-Headers", "content-type,apikey");
  response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS" || request.url === "/health")
    return response.end("{}");
  if (
    request.method === "GET" &&
    request.url.startsWith("/storage/v1/object/sign/")
  ) {
    const url = new URL(request.url, "http://localhost");
    const path = downloads.get(url.searchParams.get("token"));
    if (!path || !objects.has(path)) {
      response.statusCode = 403;
      return response.end("{}");
    }
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${url.searchParams.get("download") ?? "file"}"`,
    );
    return response.end(objects.get(path));
  }
  if (request.url === "/functions/v1/checklist-files") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await filesHandler(
      new Request("http://localhost/functions/v1/checklist-files", {
        method: "POST",
        headers: { "Content-Type": request.headers["content-type"] ?? "" },
        body: Buffer.concat(chunks),
      }),
    );
    response.statusCode = result.status;
    return response.end(await result.text());
  }
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
}
let queue = Promise.resolve();
const server = createServer((request, response) => {
  queue = queue
    .then(() => handle(request, response))
    .catch((error) => {
      response.statusCode = 500;
      response.end(JSON.stringify({ message: error.message }));
    });
});
server.listen(7788, "127.0.0.1");
const stop = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
