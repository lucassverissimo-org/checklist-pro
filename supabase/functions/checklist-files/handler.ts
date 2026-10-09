type Config = {
  url: string;
  serviceKey: string;
  cleanupSecret: string;
  fetch?: typeof fetch;
};
const bucket = "checklist-attachments";
const maxSize = 10 * 1024 * 1024;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey,content-type,x-cleanup-secret",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store",
};
const messages: Record<string, string> = {
  ACCESS_DENIED: "O link ou o anexo não está mais disponível.",
  CONFLICT: "O item mudou ou foi removido. Atualize a lista e tente novamente.",
  FILE_LIMIT: "Limite atingido: 5 anexos por item e 100 MB por checklist.",
  INVALID_FILE:
    "Escolha uma imagem JPG, PNG, WebP, GIF ou PDF válido de até 10 MB.",
};
class FileError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function validSignature(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  return mime === "application/pdf"
    ? ascii(0, 5) === "%PDF-"
    : mime === "image/jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
        : mime === "image/gif"
          ? ["GIF87a", "GIF89a"].includes(ascii(0, 6))
          : mime === "image/webp"
            ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
            : false;
}
async function limitedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new FileError(400, "Requisição vazia.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new FileError(413, messages.INVALID_FILE);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}
export function createHandler(config: Config) {
  const transport = config.fetch ?? fetch;
  const base = config.url.replace(/\/$/, "");
  const serviceHeaders = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
  };
  async function rpc(name: string, args: object) {
    const response = await transport(`${base}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { ...serviceHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const result = await response.json();
    if (!response.ok)
      throw new FileError(
        result.message === "ACCESS_DENIED" ? 403 : 400,
        messages[result.message] ||
          "Não foi possível registrar o anexo. Confira a migração do banco.",
      );
    return result;
  }
  async function cleanup() {
    const candidates: { id: string; path: string }[] = await rpc(
      "pro_file_cleanup",
      { p_ids: null },
    );
    if (!candidates.length) return 0;
    const response = await transport(`${base}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: { ...serviceHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: candidates.map((f) => f.path) }),
    });
    if (!response.ok)
      throw new FileError(502, "A limpeza do Storage falhou. Tente novamente.");
    await rpc("pro_file_cleanup", { p_ids: candidates.map((f) => f.id) });
    return candidates.length;
  }
  return async (request: Request): Promise<Response> => {
    const json = (body: object, status = 200) =>
      Response.json(body, { status, headers });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (!base || !config.serviceKey)
      return json({ error: "Configure os segredos da função." }, 503);
    try {
      const type = request.headers.get("content-type") ?? "";
      if (type.startsWith("multipart/form-data")) {
        const bytes = await limitedBody(request, maxSize + 65536);
        const form = await new Response(bytes.buffer as ArrayBuffer, {
          headers: { "Content-Type": type },
        }).formData();
        const checklistId = String(form.get("checklistId") ?? ""),
          token = String(form.get("token") ?? "");
        const sectionId = String(form.get("sectionId") ?? ""),
          taskId = String(form.get("taskId") ?? "");
        if (
          !uuid.test(checklistId) ||
          !/^[a-f\d]{64}$/i.test(token) ||
          !sectionId ||
          !taskId ||
          sectionId.length > 100 ||
          taskId.length > 100
        )
          throw new FileError(403, messages.ACCESS_DENIED);
        // Check access before processing or uploading the file.
        await rpc("pro_read", { p_id: checklistId, p_token: token });
        const file = form.get("file");
        if (
          !(file instanceof File) ||
          !file.size ||
          file.size > maxSize ||
          file.name.length > 255
        )
          throw new FileError(400, messages.INVALID_FILE);
        const content = new Uint8Array(await file.arrayBuffer());
        if (!validSignature(content, file.type))
          throw new FileError(400, messages.INVALID_FILE);
        const id = crypto.randomUUID();
        const args = { p_id: checklistId, p_token: token };
        const reserved = await rpc("pro_file", {
          ...args,
          p_action: "reserve",
          p_file: {
            id,
            sectionId,
            taskId,
            name: file.name,
            size: file.size,
            mime: file.type,
          },
        });
        const response = await transport(
          `${base}/storage/v1/object/${bucket}/${reserved.path}`,
          {
            method: "POST",
            headers: {
              ...serviceHeaders,
              "Content-Type": file.type,
              "x-upsert": "false",
            },
            body: content,
          },
        );
        if (!response.ok) {
          await rpc("pro_file", {
            ...args,
            p_action: "cancel",
            p_file: { id },
          });
          throw new FileError(
            502,
            "Não foi possível enviar. Confira se o bucket privado checklist-attachments foi criado.",
          );
        }
        try {
          await rpc("pro_file", {
            ...args,
            p_action: "commit",
            p_file: { id },
          });
        } catch (error) {
          // The item/link may have disappeared during upload. Remove the uploaded object.
          await transport(`${base}/storage/v1/object/${bucket}`, {
            method: "DELETE",
            headers: { ...serviceHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ prefixes: [reserved.path] }),
          });
          throw error;
        }
        return json({ id });
      }
      const body = JSON.parse(
        new TextDecoder().decode(await limitedBody(request, 4096)),
      );
      if (body.action === "cleanup") {
        if (
          !config.cleanupSecret ||
          request.headers.get("x-cleanup-secret") !== config.cleanupSecret
        )
          throw new FileError(403, "Acesso negado.");
        return json({ removed: await cleanup() });
      }
      if (
        !uuid.test(body.checklistId ?? "") ||
        !uuid.test(body.id ?? "") ||
        !/^[a-f\d]{64}$/i.test(body.token ?? "") ||
        !["download", "delete"].includes(body.action)
      )
        throw new FileError(403, messages.ACCESS_DENIED);
      const file = await rpc("pro_file", {
        p_id: body.checklistId,
        p_token: body.token,
        p_action: body.action,
        p_file: { id: body.id },
      });
      if (body.action === "delete") return json({ deleted: true });
      const response = await transport(
        `${base}/storage/v1/object/sign/${bucket}/${file.path}`,
        {
          method: "POST",
          headers: { ...serviceHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ expiresIn: 60 }),
        },
      );
      if (!response.ok)
        throw new FileError(502, "O arquivo não está disponível no Storage.");
      const result = await response.json();
      const signed = result.signedURL ?? result.signedUrl;
      if (typeof signed !== "string" || !signed.startsWith("/object/sign/"))
        throw new FileError(502, "Resposta inválida do Storage.");
      return json({
        url: `${base}/storage/v1${signed}${signed.includes("?") ? "&" : "?"}download=${encodeURIComponent(file.name)}`,
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof FileError
              ? error.message
              : "Não foi possível concluir a operação.",
        },
        error instanceof FileError ? error.status : 500,
      );
    }
  };
}
