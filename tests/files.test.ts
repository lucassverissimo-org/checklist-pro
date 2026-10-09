import { it } from "node:test";
import assert from "node:assert/strict";
import {
  createHandler,
  validSignature,
} from "../supabase/functions/checklist-files/handler";
import { detectList } from "../src/lists";

it("detecta listas sem separar frases por vírgulas ou pontos", () => {
  assert.deepEqual(
    detectList("1. Conferir material\r\n2) Organizar equipe\n\n• Fechar sala"),
    ["Conferir material", "Organizar equipe", "Fechar sala"],
  );
  assert.deepEqual(detectList("Comprar pão; Comprar leite"), [
    "Comprar pão",
    "Comprar leite",
  ]);
  assert.deepEqual(
    detectList("Conferir nomes, números e datas. Avisar equipe."),
    [],
  );
  assert.deepEqual(
    detectList(Array.from({ length: 101 }, () => "Item").join("\n")),
    [],
  );
});
it("valida a assinatura dos arquivos e rejeita HTML disfarçado", () => {
  assert.equal(
    validSignature(new TextEncoder().encode("%PDF-1.4"), "application/pdf"),
    true,
  );
  assert.equal(
    validSignature(new TextEncoder().encode("<html>"), "image/png"),
    false,
  );
  assert.equal(
    validSignature(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
    true,
  );
  assert.equal(
    validSignature(new TextEncoder().encode("%PDF-1.4"), "image/jpeg"),
    false,
  );
});
const id = "12345678-1234-1234-1234-123456789abc",
  fileId = "22345678-1234-1234-1234-123456789abc",
  token = "a".repeat(64);
it("nega anexos com token inválido antes de acessar o Storage", async () => {
  const calls: string[] = [];
  const handler = createHandler({
    url: "https://example.supabase.co",
    serviceKey: "server-only",
    cleanupSecret: "cleanup",
    fetch: async (url) => {
      calls.push(String(url));
      return Response.json({ message: "ACCESS_DENIED" }, { status: 400 });
    },
  });
  const result = await handler(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({
        checklistId: id,
        token,
        id: fileId,
        action: "download",
      }),
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(result.status, 403);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith("/pro_file"));
});
it("autoriza o download no banco e só depois cria URL temporária", async () => {
  const calls: string[] = [];
  const handler = createHandler({
    url: "https://example.supabase.co",
    serviceKey: "server-only",
    cleanupSecret: "cleanup",
    fetch: async (url, options) => {
      calls.push(String(url));
      assert.ok(!String(options?.body).includes("server-only"));
      return Response.json(
        calls.length === 1
          ? { path: `${id}/${fileId}`, name: "documento.pdf" }
          : {
              signedURL: `/object/sign/checklist-attachments/${id}/${fileId}?token=signed`,
            },
      );
    },
  });
  const result = await handler(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({
        checklistId: id,
        token,
        id: fileId,
        action: "download",
      }),
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  const body = await result.json();
  assert.ok(body.url.includes("download=documento.pdf"));
  assert.ok(!JSON.stringify(body).includes("server-only"));
});
it("envia PDF via Storage depois de reservar e confirma só após upload", async () => {
  const calls: string[] = [];
  const handler = createHandler({
    url: "https://example.supabase.co",
    serviceKey: "server-only",
    cleanupSecret: "cleanup",
    fetch: async (url, options) => {
      calls.push(String(url));
      if (String(url).endsWith("/pro_file")) {
        const args = JSON.parse(String(options?.body));
        calls.push(args.p_action);
        return Response.json({ path: `${id}/reserved` });
      }
      return Response.json({});
    },
  });
  const form = new FormData();
  form.set("checklistId", id);
  form.set("token", token);
  form.set("sectionId", "s1");
  form.set("taskId", "t1");
  form.set(
    "file",
    new File(["%PDF-1.4\nfile"], "file.pdf", { type: "application/pdf" }),
  );
  const result = await handler(
    new Request("https://example.test", { method: "POST", body: form }),
  );
  assert.equal(result.status, 200);
  assert.ok(
    calls.indexOf("reserve") <
      calls.findIndex((url) => url.includes("/storage/v1/object/")),
  );
  assert.equal(calls.at(-1), "commit");
});
it("a limpeza exige segredo próprio e usa API do Storage antes de remover registros", async () => {
  const calls: string[] = [];
  const handler = createHandler({
    url: "https://example.supabase.co",
    serviceKey: "server-only",
    cleanupSecret: "cleanup",
    fetch: async (url) => {
      calls.push(String(url));
      return Response.json(
        calls.length === 1 ? [{ id: fileId, path: `${id}/${fileId}` }] : [],
      );
    },
  });
  const request = (secret: string) =>
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ action: "cleanup" }),
      headers: {
        "Content-Type": "application/json",
        "x-cleanup-secret": secret,
      },
    });
  assert.equal((await handler(request("wrong"))).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await handler(request("cleanup"))).status, 200);
  assert.equal(calls.length, 3);
  assert.ok(calls[1].includes("/storage/v1/object/"));
});
