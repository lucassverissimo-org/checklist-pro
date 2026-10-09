import type { Access, Attachment, Snapshot } from "./model";
import { uniqueId } from "./model";

const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const key = import.meta.env.VITE_SUPABASE_PUBLIC_KEY;
export const fileTypes =
  "image/jpeg,image/png,image/webp,image/gif,application/pdf";
export const maxFileSize = 10 * 1024 * 1024;
const demoKey = (id: string) => `checklist-pro:demo:v1:${id}`;

async function blobStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("checklist-pro-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onerror = () =>
      reject(new Error("Não foi possível acessar os arquivos locais."));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("files", mode);
      const op = action(tx.objectStore("files"));
      tx.oncomplete = () => {
        resolve(op.result);
        db.close();
      };
      tx.onerror = () => {
        reject(new Error("Não foi possível salvar o arquivo local."));
        db.close();
      };
      tx.onabort = tx.onerror;
    };
  });
}

export async function clearDemoFiles(ids: string[]) {
  for (const id of ids)
    await blobStore("readwrite", (store) => store.delete(id));
}

export async function cleanupDemoTrash(checklistId: string) {
  const key = `checklist-pro:undo:${checklistId}`;
  const records: Record<
    string,
    { expiresAt: string; attachments: Attachment[] }
  > = JSON.parse(localStorage.getItem(key) ?? "{}");
  const expired = Object.entries(records).filter(
    ([, record]) => Date.parse(record.expiresAt) <= Date.now(),
  );
  if (!expired.length) return;
  await clearDemoFiles(
    expired.flatMap(([, record]) => record.attachments.map((file) => file.id)),
  );
  const latest = JSON.parse(localStorage.getItem(key) ?? "{}");
  for (const [id] of expired) delete latest[id];
  localStorage.setItem(key, JSON.stringify(latest));
}

export async function fileAction(
  access: Access,
  action: "download" | "delete",
  id: string,
): Promise<{ url?: string }> {
  if (access.demo) {
    const snapshot: Snapshot = JSON.parse(
      localStorage.getItem(demoKey(access.id))!,
    );
    if (!snapshot.attachments?.some((file) => file.id === id))
      throw new Error("Anexo indisponível.");
    if (action === "download") {
      const blob = await blobStore<Blob | undefined>("readonly", (store) =>
        store.get(id),
      );
      if (!blob)
        throw new Error(
          "Este arquivo não está mais disponível neste navegador.",
        );
      return { url: URL.createObjectURL(blob) };
    }
    snapshot.attachments = snapshot.attachments.filter(
      (file) => file.id !== id,
    );
    snapshot.revision++;
    localStorage.setItem(demoKey(access.id), JSON.stringify(snapshot));
    await blobStore("readwrite", (store) => store.delete(id));
    return {};
  }
  const response = await fetch(`${base}/functions/v1/checklist-files`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      checklistId: access.id,
      token: access.token,
      action,
      id,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error ||
        "Não foi possível acessar o anexo. Confira a configuração da função no Supabase.",
    );
  return result;
}

export async function uploadFile(
  access: Access,
  sectionId: string,
  taskId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  if (
    !fileTypes.split(",").includes(file.type) ||
    !file.size ||
    file.size > maxFileSize
  )
    throw new Error(
      "Escolha uma imagem JPG, PNG, WebP, GIF ou PDF de até 10 MB.",
    );
  if (access.demo) {
    const id = uniqueId();
    await blobStore("readwrite", (store) => store.put(file, id));
    try {
      const snapshot: Snapshot = JSON.parse(
        localStorage.getItem(demoKey(access.id))!,
      );
      const task = snapshot.document.sections
        .find((section) => section.id === sectionId)
        ?.tasks.find((task) => task.id === taskId);
      const files = snapshot.attachments ?? [];
      if (
        !task ||
        files.filter(
          (file) => file.sectionId === sectionId && file.taskId === taskId,
        ).length >= 5 ||
        files.reduce((sum, file) => sum + file.size, 0) + file.size >
          100 * 1024 * 1024
      )
        throw new Error(
          "O item foi removido ou o limite de anexos foi atingido (5 por item; 100 MB por checklist).",
        );
      const attachment: Attachment = {
        id,
        sectionId,
        taskId,
        name: file.name,
        size: file.size,
        mime: file.type,
      };
      snapshot.attachments = [...files, attachment];
      snapshot.revision++;
      localStorage.setItem(demoKey(access.id), JSON.stringify(snapshot));
      onProgress(100);
    } catch (error) {
      await blobStore("readwrite", (store) => store.delete(id));
      throw error;
    }
    return;
  }
  const data = new FormData();
  data.set("checklistId", access.id);
  data.set("token", access.token);
  data.set("sectionId", sectionId);
  data.set("taskId", taskId);
  data.set("file", file);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/functions/v1/checklist-files`);
    xhr.setRequestHeader("apikey", key);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(
          Math.min(99, Math.round((event.loaded / event.total) * 100)),
        );
    };
    xhr.onerror = xhr.ontimeout = () =>
      reject(
        new Error("O envio falhou. Confira a lista antes de tentar novamente."),
      );
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        let message =
          "Não foi possível enviar. Confira a configuração do Storage e da função no Supabase.";
        try {
          message = JSON.parse(xhr.responseText).error || message;
        } catch {}
        reject(new Error(message));
      }
    };
    xhr.send(data);
  });
}
