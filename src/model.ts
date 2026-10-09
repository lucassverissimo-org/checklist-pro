export type Priority = "none" | "low" | "medium" | "high";
export type Task = {
  id: string;
  text: string;
  done: boolean;
  comment: string;
  priority?: Priority;
};
export type Attachment = {
  id: string;
  sectionId: string;
  taskId: string;
  name: string;
  size: number;
  mime: string;
};
export type Undo = { id: string; expiresAt: string; label: string };
export type Section = { id: string; title: string; tasks: Task[] };
export type Checklist = { title: string; sections: Section[] };
export type Snapshot = {
  document: Checklist;
  revision: number;
  role: "edit" | "admin";
  updatedAt: string;
  attachments?: Attachment[];
  undo?: Undo;
};
export type Access = {
  id: string;
  token: string;
  demo?: boolean;
  editToken?: string;
};
export type Recent = Access & { title: string; visitedAt: string };
export type Operation =
  | { type: "rename"; title: string; expected: string }
  | { type: "add_section"; section: Section }
  | {
      type: "move_section";
      sectionId: string;
      beforeId: string | null;
      expectedOrder: string[];
    }
  | {
      type: "move_task";
      sectionId: string;
      taskId: string;
      toSectionId: string;
      beforeId: string | null;
      expectedSourceOrder: string[];
      expectedTargetOrder: string[];
    }
  | {
      type: "update_section";
      sectionId: string;
      title: string;
      expected: string;
    }
  | { type: "restore"; undoId: string }
  | {
      type: "delete_section";
      sectionId: string;
      expected: Section;
      undoId?: string;
    }
  | { type: "add_tasks"; sectionId: string; tasks: Task[] }
  | { type: "add_task"; sectionId: string; task: Task }
  | {
      type: "update_task";
      sectionId: string;
      taskId: string;
      patch: Partial<Pick<Task, "text" | "done" | "comment" | "priority">>;
      expected: Partial<Pick<Task, "text" | "done" | "comment" | "priority">>;
    }
  | {
      type: "delete_task";
      sectionId: string;
      taskId: string;
      expected: Task;
      undoId?: string;
    };

export class ChecklistError extends Error {
  constructor(
    public code: "conflict" | "access" | "network" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export function token(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function uniqueId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  // The fallback also works when a phone opens a development server over LAN HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function accessLink(
  access: Access,
  address = window.location.href,
): string {
  const url = new URL(address);
  url.search = "";
  url.hash = new URLSearchParams({
    id: access.id,
    key: access.token,
    ...(access.demo ? { demo: "1" } : {}),
  }).toString();
  return url.href;
}

export function parseAccess(hash: string): Access | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const id = params.get("id");
  const key = params.get("key");
  return id &&
    /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id) &&
    key &&
    /^[a-f\d]{64}$/i.test(key)
    ? { id, token: key, demo: params.get("demo") === "1" }
    : null;
}

export function newChecklist(title: string, example = false): Checklist {
  return {
    title: title.trim(),
    sections: example
      ? [
          {
            id: uniqueId(),
            title: "Antes de começar",
            tasks: [
              {
                id: uniqueId(),
                text: "Definir o que precisa ser feito",
                done: false,
                comment: "",
              },
              {
                id: uniqueId(),
                text: "Combinar os detalhes com a equipe",
                done: false,
                comment: "",
              },
            ],
          },
          {
            id: uniqueId(),
            title: "Mãos à obra",
            tasks: [
              {
                id: uniqueId(),
                text: "Conferir se está tudo pronto",
                done: false,
                comment: "",
              },
            ],
          },
        ]
      : [],
  };
}

export function validateDocument(value: unknown): value is Checklist {
  if (!value || typeof value !== "object") return false;
  const data = value as Checklist;
  const text = (value: unknown, max: number, blank = false) =>
    typeof value === "string" &&
    value.length <= max &&
    (blank || !!value.trim());
  return (
    text(data.title, 120) &&
    Array.isArray(data.sections) &&
    data.sections.length <= 100 &&
    new Set(data.sections.map((s) => s?.id)).size === data.sections.length &&
    data.sections.every(
      (s) =>
        s &&
        text(s.id, 100) &&
        text(s.title, 120) &&
        Array.isArray(s.tasks) &&
        s.tasks.length <= 500 &&
        new Set(s.tasks.map((t) => t?.id)).size === s.tasks.length &&
        s.tasks.every(
          (t) =>
            t &&
            text(t.id, 100) &&
            text(t.text, 2000) &&
            typeof t.done === "boolean" &&
            text(t.comment, 10000, true) &&
            (t.priority === undefined ||
              ["none", "low", "medium", "high"].includes(t.priority)),
        ),
    ) &&
    data.sections.reduce((count, s) => count + s.tasks.length, 0) <= 2000 &&
    new TextEncoder().encode(JSON.stringify(data)).length <= 262144
  );
}

// The local demonstration mirrors the server's field-level conflict rules.
export function applyOperation(document: Checklist, op: Operation): Checklist {
  const next = structuredClone(document);
  const conflict = () => {
    throw new ChecklistError(
      "conflict",
      "Este item mudou enquanto você editava. Revise a versão atual antes de salvar novamente.",
    );
  };
  if (op.type === "restore") {
    throw new ChecklistError(
      "invalid",
      "A restauração exige o registro da exclusão.",
    );
  } else if (op.type === "rename") {
    if (next.title !== op.expected) conflict();
    next.title = op.title;
  } else if (op.type === "add_section") {
    if (next.sections.some((s) => s.id === op.section.id)) conflict();
    next.sections.push(op.section);
  } else if (op.type === "move_section") {
    if (
      JSON.stringify(next.sections.map((s) => s.id)) !==
      JSON.stringify(op.expectedOrder)
    )
      conflict();
    const index = next.sections.findIndex((s) => s.id === op.sectionId);
    if (index < 0 || op.beforeId === op.sectionId) return conflict();
    const [section] = next.sections.splice(index, 1);
    const target =
      op.beforeId === null
        ? next.sections.length
        : next.sections.findIndex((s) => s.id === op.beforeId);
    if (target < 0) return conflict();
    next.sections.splice(target, 0, section);
  } else if (op.type === "move_task") {
    const source = next.sections.find((s) => s.id === op.sectionId);
    const target = next.sections.find((s) => s.id === op.toSectionId);
    if (
      !source ||
      !target ||
      JSON.stringify(source.tasks.map((t) => t.id)) !==
        JSON.stringify(op.expectedSourceOrder) ||
      JSON.stringify(target.tasks.map((t) => t.id)) !==
        JSON.stringify(op.expectedTargetOrder)
    )
      return conflict();
    const index = source.tasks.findIndex((t) => t.id === op.taskId);
    if (index < 0 || (source === target && op.beforeId === op.taskId))
      return conflict();
    const [task] = source.tasks.splice(index, 1);
    if (target.tasks.some((t) => t.id === task.id)) return conflict();
    const position =
      op.beforeId === null
        ? target.tasks.length
        : target.tasks.findIndex((t) => t.id === op.beforeId);
    if (position < 0) return conflict();
    target.tasks.splice(position, 0, task);
  } else {
    const section = next.sections.find((s) => s.id === op.sectionId);
    if (!section) return conflict();
    if (op.type === "update_section") {
      if (section.title !== op.expected) conflict();
      section.title = op.title;
    } else if (op.type === "delete_section") {
      if (JSON.stringify(section) !== JSON.stringify(op.expected)) conflict();
      next.sections = next.sections.filter((s) => s.id !== section.id);
    } else if (op.type === "add_tasks") {
      if (!op.tasks.length || op.tasks.length > 100)
        throw new ChecklistError("invalid", "Cole até 100 itens por vez.");
      for (const task of op.tasks) {
        if (section.tasks.some((t) => t.id === task.id)) conflict();
        section.tasks.push(task);
      }
    } else if (op.type === "add_task") {
      if (section.tasks.some((t) => t.id === op.task.id)) conflict();
      section.tasks.push(op.task);
    } else {
      const task = section.tasks.find((t) => t.id === op.taskId);
      if (!task) return conflict();
      if (op.type === "delete_task") {
        if (JSON.stringify(task) !== JSON.stringify(op.expected)) conflict();
        section.tasks = section.tasks.filter((t) => t.id !== task.id);
      } else {
        for (const field of Object.keys(
          op.patch,
        ) as (keyof typeof op.patch)[]) {
          if (
            !(field in op.expected) ||
            (field === "priority" ? (task.priority ?? "none") : task[field]) !==
              op.expected[field]
          )
            conflict();
        }
        Object.assign(task, op.patch);
      }
    }
  }
  if (!validateDocument(next))
    throw new ChecklistError(
      "invalid",
      "Confira os textos e o limite de tamanho do checklist.",
    );
  return next;
}
