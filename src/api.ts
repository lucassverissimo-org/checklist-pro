import {
  applyOperation,
  ChecklistError,
  token,
  uniqueId,
  validateDocument,
  type Access,
  type Checklist,
  type Operation,
  type Recent,
  type Snapshot,
} from "./model";

const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const publicKey = import.meta.env.VITE_SUPABASE_PUBLIC_KEY;
export const configured =
  !!base &&
  !!publicKey &&
  !base.includes("YOUR-PROJECT") &&
  publicKey !== "YOUR-PUBLIC-KEY";
const RECENTS_KEY = "checklist-pro:recent:v1";
const demoKey = (id: string) => `checklist-pro:demo:v1:${id}`;

async function rpc<T>(name: string, body: object): Promise<T> {
  try {
    const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: publicKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json();
    if (!response.ok) {
      if (
        result.message === "INVALID_OPERATION" &&
        name === "pro_apply" &&
        ["move_task", "move_section"].includes(
          (body as { p_operation?: Operation }).p_operation?.type ?? "",
        )
      ) {
        throw new ChecklistError(
          "invalid",
          "Atualize o banco com o script de ordenação do Checklist Pro para mover os itens.",
        );
      }
      const code =
        result.message === "CONFLICT"
          ? "conflict"
          : result.message === "ACCESS_DENIED"
            ? "access"
            : "invalid";
      throw new ChecklistError(
        code,
        code === "conflict"
          ? "Este item mudou enquanto você editava. Revise a versão atual antes de salvar novamente."
          : code === "access"
            ? "Este link foi revogado, está incorreto ou o checklist foi excluído."
            : "Não foi possível concluir a operação. Confira os limites dos textos e a configuração do serviço.",
      );
    }
    return result as T;
  } catch (error) {
    if (error instanceof ChecklistError) throw error;
    throw new ChecklistError(
      "network",
      "Não foi possível conectar. Seu texto foi mantido; verifique a conexão e tente novamente.",
    );
  }
}

export function recents(): Recent[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter(
          (entry) =>
            entry &&
            typeof entry.id === "string" &&
            typeof entry.token === "string" &&
            typeof entry.title === "string",
        )
      : [];
  } catch {
    return [];
  }
}
export function remember(access: Access, title: string) {
  const entries = recents();
  const old = entries.find(
    (entry) => entry.id === access.id && entry.demo === access.demo,
  );
  // Visiting an editing link must not discard an administrator key already saved here.
  const entry = {
    ...old,
    ...access,
    title,
    visitedAt: new Date().toISOString(),
  };
  if (old?.editToken === access.token) entry.token = old.token;
  try {
    localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify(
        [
          entry,
          ...entries.filter(
            (item) => item.id !== access.id || item.demo !== access.demo,
          ),
        ].slice(0, 30),
      ),
    );
  } catch {
    /* Access remains in the address bar if storage is unavailable. */
  }
}
export function forget(id: string) {
  try {
    localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify(recents().filter((entry) => entry.id !== id)),
    );
  } catch {}
}

export async function create(
  document: Checklist,
  demo: boolean,
): Promise<Access> {
  if (!validateDocument(document))
    throw new ChecklistError(
      "invalid",
      "Confira o nome e o tamanho do checklist.",
    );
  const access: Access = {
    id: uniqueId(),
    token: token(),
    editToken: token(),
    demo,
  };
  if (demo) {
    localStorage.setItem(
      demoKey(access.id),
      JSON.stringify({
        document,
        revision: 0,
        role: "admin",
        updatedAt: new Date().toISOString(),
      }),
    );
  } else {
    // Keep the keys locally before sending, so a lost response does not lose access.
    remember(access, document.title);
    await rpc("pro_create", {
      p_id: access.id,
      p_admin_token: access.token,
      p_edit_token: access.editToken,
      p_document: document,
    });
  }
  remember(access, document.title);
  return access;
}
export async function read(access: Access): Promise<Snapshot> {
  if (!access.demo && !configured)
    throw new ChecklistError(
      "invalid",
      "O serviço compartilhado ainda não está configurado neste site.",
    );
  if (!access.demo)
    return rpc("pro_read", { p_id: access.id, p_token: access.token });
  const raw = localStorage.getItem(demoKey(access.id));
  if (!raw)
    throw new ChecklistError(
      "access",
      "Esta demonstração existe apenas no navegador onde foi criada.",
    );
  return JSON.parse(raw);
}
export async function mutate(
  access: Access,
  operation: Operation,
): Promise<Snapshot> {
  if (!access.demo)
    return rpc("pro_apply", {
      p_id: access.id,
      p_token: access.token,
      p_operation: operation,
    });
  const current = await read(access);
  const next = {
    ...current,
    document: applyOperation(current.document, operation),
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(demoKey(access.id), JSON.stringify(next));
  return next;
}
export async function rotate(access: Access): Promise<string> {
  const editToken = token();
  await rpc("pro_manage", {
    p_id: access.id,
    p_token: access.token,
    p_action: "rotate",
    p_edit_token: editToken,
  });
  return editToken;
}
export async function remove(access: Access) {
  if (access.demo) localStorage.removeItem(demoKey(access.id));
  else
    await rpc("pro_manage", {
      p_id: access.id,
      p_token: access.token,
      p_action: "delete",
      p_edit_token: null,
    });
  forget(access.id);
}
