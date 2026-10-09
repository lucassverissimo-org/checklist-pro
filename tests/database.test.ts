import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyOperation,
  newChecklist,
  token,
  validateDocument,
  parseAccess,
  accessLink,
  type Snapshot,
} from "../src/model";

let db: PGlite;
const admin = "a".repeat(64),
  edit = "b".repeat(64),
  rotated = "c".repeat(64);
const id = "12345678-1234-1234-1234-123456789abc";
const document = {
  title: "Evento da equipe",
  sections: [
    {
      id: "s1",
      title: "Preparação",
      tasks: [
        { id: "t1", text: "Conferir material", done: false, comment: "" },
        { id: "t2", text: "Organizar equipe", done: false, comment: "" },
      ],
    },
  ],
};
async function rpc(name: string, params: unknown[]) {
  const { rows } = await db.query<{ result: Snapshot }>(
    `select public.${name}(${params.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
    params.map((p) => (p && typeof p === "object" ? JSON.stringify(p) : p)),
  );
  return rows[0].result;
}
before(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  await db.exec(
    await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
  );
  await db.exec("set role anon;");
});
after(async () => {
  await db?.close();
});

describe(
  "detalhes, lote, restauração e anexos privados",
  { concurrency: false },
  () => {
    it("migra uma instalação anterior e mantém as mesmas funções do schema de produção", async () => {
      const legacy = new PGlite();
      try {
        await legacy.exec(
          "create role anon; create role authenticated; create role service_role;",
        );
        await legacy.exec(
          await readFile(
            new URL("./fixtures/schema-before-details.sql", import.meta.url),
            "utf8",
          ),
        );
        await legacy.query("select public.pro_create($1,$2,$3,$4)", [
          id,
          admin,
          edit,
          JSON.stringify(document),
        ]);
        const before = await legacy.query<{ result: Snapshot }>(
          "select public.pro_read($1,$2) as result",
          [id, edit],
        );
        await legacy.exec(
          await readFile(
            new URL(
              "../supabase/migrations/20261009_002_item_details.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        const after = await legacy.query<{ result: Snapshot }>(
          "select public.pro_read($1,$2) as result",
          [id, edit],
        );
        assert.deepEqual(
          after.rows[0].result.document,
          before.rows[0].result.document,
        );
        assert.equal(
          after.rows[0].result.revision,
          before.rows[0].result.revision,
        );
        assert.equal(
          after.rows[0].result.updatedAt,
          before.rows[0].result.updatedAt,
        );
        await db.exec("reset role;");
        try {
          for (const signature of [
            "public.pro_apply(uuid,text,jsonb)",
            "public.pro_file(uuid,text,text,jsonb)",
            "public.pro_file_cleanup(uuid[])",
            "public.pro_manage(uuid,text,text,text)",
            "checklist_private.valid_document(jsonb)",
            "checklist_private.snapshot(checklist_private.checklists,text)",
          ]) {
            const query =
              "select pg_get_functiondef($1::regprocedure) as definition";
            assert.deepEqual(
              (await legacy.query(query, [signature])).rows,
              (await db.query(query, [signature])).rows,
            );
          }
        } finally {
          await db.exec("set role anon;");
        }
        await legacy.exec("set role anon;");
        await assert.rejects(
          legacy.query("select public.pro_file($1,$2,'download','{}')", [
            id,
            edit,
          ]),
          /permission denied/,
        );
      } finally {
        await legacy.close();
      }
    });
    const key = "32345678-1234-1234-1234-123456789abc";
    const file = "42345678-1234-1234-1234-123456789abc";
    async function service(action: string, info: object) {
      await db.exec("reset role; set role service_role;");
      try {
        return await rpc("pro_file", [key, edit, action, info]);
      } finally {
        await db.exec("reset role; set role anon;");
      }
    }
    it("mantém documentos antigos e aplica prioridade com conflito por campo", async () => {
      await rpc("pro_create", [key, admin, edit, document]);
      const op = {
        type: "update_task",
        sectionId: "s1",
        taskId: "t1",
        patch: { priority: "high" },
        expected: { priority: "none" },
      };
      const result = await rpc("pro_apply", [key, edit, op]);
      assert.equal(result.document.sections[0].tasks[0].priority, "high");
      await assert.rejects(rpc("pro_apply", [key, edit, op]), /CONFLICT/);
      await assert.rejects(
        rpc("pro_apply", [
          key,
          edit,
          {
            ...op,
            patch: { priority: "urgent" },
            expected: { priority: "high" },
          },
        ]),
        /INVALID_DOCUMENT/,
      );
    });
    it("salva listas em lote e reverte todo o lote quando um ID é duplicado", async () => {
      const task = {
        id: "batch1",
        text: "Item colado",
        done: false,
        comment: "",
      };
      await rpc("pro_apply", [
        key,
        edit,
        {
          type: "add_tasks",
          sectionId: "s1",
          tasks: [task, { ...task, id: "batch2" }],
        },
      ]);
      const before = await rpc("pro_read", [key, edit]);
      await assert.rejects(
        rpc("pro_apply", [
          key,
          edit,
          {
            type: "add_tasks",
            sectionId: "s1",
            tasks: [{ ...task, id: "not-added" }, task],
          },
        ]),
        /CONFLICT/,
      );
      assert.deepEqual(await rpc("pro_read", [key, edit]), before);
    });
    it("nega RPC de arquivos ao navegador e mantém uploads pendentes fora da leitura", async () => {
      await assert.rejects(
        rpc("pro_file", [key, edit, "reserve", {}]),
        /permission denied/,
      );
      await assert.rejects(
        rpc("pro_file_cleanup", [null]),
        /permission denied/,
      );
      await service("reserve", {
        id: file,
        sectionId: "s1",
        taskId: "t1",
        name: "Foto.png",
        size: 100,
        mime: "image/png",
      });
      assert.deepEqual((await rpc("pro_read", [key, edit])).attachments, []);
      await service("commit", { id: file });
      assert.equal(
        (await rpc("pro_read", [key, edit])).attachments?.[0].name,
        "Foto.png",
      );
      await assert.rejects(
        service("reserve", {
          id: "52345678-1234-1234-1234-123456789abc",
          sectionId: "s1",
          taskId: "t1",
          name: "file.html",
          size: 100,
          mime: "text/html",
        }),
        /INVALID_FILE/,
      );
    });
    it("anexos acompanham o item ao mover entre seções", async () => {
      await rpc("pro_apply", [
        key,
        edit,
        {
          type: "add_section",
          section: { id: "destination", title: "Destino", tasks: [] },
        },
      ]);
      const snapshot = await rpc("pro_read", [key, edit]);
      const ids = snapshot.document.sections[0].tasks.map((task) => task.id);
      const moved = await rpc("pro_apply", [
        key,
        edit,
        {
          type: "move_task",
          sectionId: "s1",
          taskId: "t1",
          toSectionId: "destination",
          beforeId: null,
          expectedSourceOrder: ids,
          expectedTargetOrder: [],
        },
      ]);
      assert.equal(moved.attachments?.[0].sectionId, "destination");
      await rpc("pro_apply", [
        key,
        edit,
        {
          type: "move_task",
          sectionId: "destination",
          taskId: "t1",
          toSectionId: "s1",
          beforeId: ids[1],
          expectedSourceOrder: ["t1"],
          expectedTargetOrder: ids.slice(1),
        },
      ]);
      assert.equal(
        (await rpc("pro_read", [key, edit])).attachments?.[0].sectionId,
        "s1",
      );
    });
    it("desfaz exclusão preservando prioridade, comentário e anexos sem reverter outros itens", async () => {
      const before = await rpc("pro_read", [key, edit]);
      const deleted = await rpc("pro_apply", [
        key,
        edit,
        {
          type: "delete_task",
          sectionId: "s1",
          taskId: "t1",
          expected: before.document.sections[0].tasks[0],
        },
      ]);
      assert.ok(deleted.undo?.id);
      assert.deepEqual(deleted.attachments, []);
      await rpc("pro_apply", [
        key,
        edit,
        {
          type: "update_task",
          sectionId: "s1",
          taskId: "t2",
          patch: { comment: "Edição independente" },
          expected: { comment: "" },
        },
      ]);
      const restored = await rpc("pro_apply", [
        key,
        edit,
        { type: "restore", undoId: deleted.undo.id },
      ]);
      assert.equal(restored.document.sections[0].tasks[0].priority, "high");
      assert.equal(
        restored.document.sections[0].tasks[1].comment,
        "Edição independente",
      );
      assert.equal(restored.attachments?.[0].id, file);
      await assert.rejects(
        rpc("pro_apply", [
          key,
          edit,
          { type: "restore", undoId: deleted.undo.id },
        ]),
        /UNDO_EXPIRED/,
      );
    });
    it("restaura seções e impede restauração expirada", async () => {
      const before = await rpc("pro_read", [key, edit]);
      const deleted = await rpc("pro_apply", [
        key,
        edit,
        {
          type: "delete_section",
          sectionId: "s1",
          expected: before.document.sections[0],
        },
      ]);
      const restored = await rpc("pro_apply", [
        key,
        edit,
        { type: "restore", undoId: deleted.undo!.id },
      ]);
      assert.deepEqual(restored.document, before.document);
      assert.deepEqual(restored.attachments, before.attachments);
      const gone = await rpc("pro_apply", [
        key,
        edit,
        {
          type: "delete_task",
          sectionId: "s1",
          taskId: "t1",
          expected: restored.document.sections[0].tasks[0],
        },
      ]);
      await db.exec("reset role;");
      await db.query(
        "update checklist_private.trash set expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [gone.undo!.id],
      );
      await db.exec("set role anon;");
      await assert.rejects(
        rpc("pro_apply", [
          key,
          edit,
          { type: "restore", undoId: gone.undo!.id },
        ]),
        /UNDO_EXPIRED/,
      );
    });
    it("limita reservas concorrentes de arquivos a cinco por item", async () => {
      for (let i = 0; i < 5; i++)
        await service("reserve", {
          id: `62345678-1234-1234-1234-123456789ab${i}`,
          sectionId: "s1",
          taskId: "t2",
          name: "Doc.pdf",
          size: 100,
          mime: "application/pdf",
        });
      await assert.rejects(
        service("reserve", {
          id: "62345678-1234-1234-1234-123456789ab5",
          sectionId: "s1",
          taskId: "t2",
          name: "Doc.pdf",
          size: 100,
          mime: "application/pdf",
        }),
        /FILE_LIMIT/,
      );
      await db.exec("reset role; set role service_role;");
      try {
        await assert.rejects(
          rpc("pro_file", [key, "d".repeat(64), "download", { id: file }]),
          /ACCESS_DENIED/,
        );
      } finally {
        await db.exec("reset role; set role anon;");
      }
    });
  },
);

describe(
  "API de colaboração real em PostgreSQL",
  { concurrency: false },
  () => {
    it("cria sem login e não expõe chaves", async () => {
      const result = await rpc("pro_create", [id, admin, edit, document]);
      assert.deepEqual(result.document, document);
      assert.equal(result.role, "admin");
      assert.ok(!JSON.stringify(result).includes(admin));
      assert.equal((await rpc("pro_read", [id, edit])).role, "edit");
    });
    it("nega acesso direto e links incorretos", async () => {
      await assert.rejects(
        db.query("select * from checklist_private.checklists"),
      );
      await assert.rejects(
        rpc("pro_read", [id, "d".repeat(64)]),
        /ACCESS_DENIED/,
      );
      await assert.rejects(
        rpc("pro_apply", [
          id,
          null,
          { type: "rename", title: "X", expected: document.title },
        ]),
        /ACCESS_DENIED/,
      );
      await assert.rejects(
        rpc("pro_manage", [id, edit, "delete", null]),
        /ACCESS_DENIED/,
      );
    });
    it("preserva alterações independentes no mesmo item", async () => {
      await rpc("pro_apply", [
        id,
        edit,
        {
          type: "update_task",
          sectionId: "s1",
          taskId: "t1",
          patch: { done: true },
          expected: { done: false },
        },
      ]);
      const next = await rpc("pro_apply", [
        id,
        edit,
        {
          type: "update_task",
          sectionId: "s1",
          taskId: "t1",
          patch: { comment: "Confirmado ✅\nSegunda linha" },
          expected: { comment: "" },
        },
      ]);
      assert.equal(next.document.sections[0].tasks[0].done, true);
      assert.ok(next.document.sections[0].tasks[0].comment.includes("✅"));
      assert.equal(next.revision, 2);
    });
    it("rejeita texto concorrente sem sobrescrever", async () => {
      const operation = {
        type: "update_task",
        sectionId: "s1",
        taskId: "t2",
        patch: { text: "Organizar fiscais" },
        expected: { text: "Organizar equipe" },
      };
      await rpc("pro_apply", [id, edit, operation]);
      await assert.rejects(
        rpc("pro_apply", [
          id,
          admin,
          { ...operation, patch: { text: "Texto concorrente" } },
        ]),
        /CONFLICT/,
      );
      assert.equal(
        (await rpc("pro_read", [id, edit])).document.sections[0].tasks[1].text,
        "Organizar fiscais",
      );
    });
    it("impede exclusão de uma seção que mudou", async () => {
      await assert.rejects(
        rpc("pro_apply", [
          id,
          edit,
          {
            type: "delete_section",
            sectionId: "s1",
            expected: document.sections[0],
          },
        ]),
        /CONFLICT/,
      );
    });
    it("valida conteúdo e campos alteráveis", async () => {
      await assert.rejects(
        rpc("pro_apply", [
          id,
          edit,
          {
            type: "update_task",
            sectionId: "s1",
            taskId: "t1",
            patch: { id: "outro" },
            expected: { id: "t1" },
          },
        ]),
        /INVALID_OPERATION/,
      );
      await assert.rejects(
        rpc("pro_apply", [
          id,
          edit,
          { type: "rename", title: " ", expected: document.title },
        ]),
        /INVALID_DOCUMENT/,
      );
      await assert.rejects(
        rpc("pro_create", [
          crypto.randomUUID(),
          admin,
          edit,
          { title: "Teste", sections: [null] },
        ]),
        /INVALID_DOCUMENT/,
      );
    });
    it("adiciona, renomeia e exclui itens mantendo o resto", async () => {
      await rpc("pro_apply", [
        id,
        edit,
        {
          type: "add_section",
          section: { id: "s2", title: "Execução", tasks: [] },
        },
      ]);
      await rpc("pro_apply", [
        id,
        edit,
        {
          type: "update_section",
          sectionId: "s2",
          title: "Encerramento",
          expected: "Execução",
        },
      ]);
      const task = {
        id: "t3",
        text: "Conferir sala",
        done: false,
        comment: "",
      };
      await rpc("pro_apply", [
        id,
        edit,
        { type: "add_task", sectionId: "s2", task },
      ]);
      const next = await rpc("pro_apply", [
        id,
        edit,
        { type: "delete_task", sectionId: "s2", taskId: "t3", expected: task },
      ]);
      assert.deepEqual(next.document.sections[1], {
        id: "s2",
        title: "Encerramento",
        tasks: [],
      });
      await rpc("pro_apply", [
        id,
        edit,
        {
          type: "delete_section",
          sectionId: "s2",
          expected: next.document.sections[1],
        },
      ]);
    });
    it("revoga a chave antiga e preserva a administração", async () => {
      await rpc("pro_manage", [id, admin, "rotate", rotated]);
      await assert.rejects(rpc("pro_read", [id, edit]), /ACCESS_DENIED/);
      assert.equal((await rpc("pro_read", [id, rotated])).role, "edit");
      assert.equal((await rpc("pro_read", [id, admin])).role, "admin");
      await assert.rejects(
        rpc("pro_manage", [id, rotated, "rotate", edit]),
        /ACCESS_DENIED/,
      );
    });
    it("exclui definitivamente só com chave administrativa", async () => {
      await rpc("pro_manage", [id, admin, "delete", null]);
      await assert.rejects(rpc("pro_read", [id, admin]), /ACCESS_DENIED/);
    });
  },
);

describe("ordenação e atualização do banco existente", () => {
  const initial = {
    title: "Ordenação",
    sections: [
      {
        id: "first",
        title: "Primeira",
        tasks: [
          {
            id: "a",
            text: "Item A",
            done: true,
            comment: "Comentário original",
          },
          { id: "b", text: "Item B", done: false, comment: "" },
          { id: "c", text: "Item C", done: false, comment: "" },
        ],
      },
      { id: "empty", title: "Vazia", tasks: [] },
      { id: "last", title: "Última", tasks: [] },
    ],
  };
  async function setup() {
    const key = crypto.randomUUID();
    await rpc("pro_create", [key, admin, edit, initial]);
    return key;
  }
  it("reordena seções sem modificar o conteúdo", async () => {
    const key = await setup();
    const moved = await rpc("pro_apply", [
      key,
      edit,
      {
        type: "move_section",
        sectionId: "last",
        beforeId: "first",
        expectedOrder: ["first", "empty", "last"],
      },
    ]);
    assert.deepEqual(
      moved.document.sections.map((s) => s.id),
      ["last", "first", "empty"],
    );
    assert.deepEqual(moved.document.sections[1], initial.sections[0]);
    const end = await rpc("pro_apply", [
      key,
      edit,
      {
        type: "move_section",
        sectionId: "last",
        beforeId: null,
        expectedOrder: ["last", "first", "empty"],
      },
    ]);
    assert.deepEqual(end.document, initial);
  });
  it("reordena itens e preserva marcações e comentários", async () => {
    const key = await setup();
    const moved = await rpc("pro_apply", [
      key,
      edit,
      {
        type: "move_task",
        sectionId: "first",
        taskId: "a",
        toSectionId: "first",
        beforeId: null,
        expectedSourceOrder: ["a", "b", "c"],
        expectedTargetOrder: ["a", "b", "c"],
      },
    ]);
    assert.deepEqual(
      moved.document.sections[0].tasks.map((t) => t.id),
      ["b", "c", "a"],
    );
    assert.deepEqual(
      moved.document.sections[0].tasks[2],
      initial.sections[0].tasks[0],
    );
  });
  it("move entre seções vazias e preserva uma edição feita durante o arraste", async () => {
    const key = await setup();
    await rpc("pro_apply", [
      key,
      edit,
      {
        type: "update_task",
        sectionId: "first",
        taskId: "a",
        patch: { comment: "Atualizado por outra pessoa" },
        expected: { comment: "Comentário original" },
      },
    ]);
    const moved = await rpc("pro_apply", [
      key,
      edit,
      {
        type: "move_task",
        sectionId: "first",
        taskId: "a",
        toSectionId: "last",
        beforeId: null,
        expectedSourceOrder: ["a", "b", "c"],
        expectedTargetOrder: [],
      },
    ]);
    assert.deepEqual(
      moved.document.sections[0].tasks.map((t) => t.id),
      ["b", "c"],
    );
    assert.equal(
      moved.document.sections[2].tasks[0].comment,
      "Atualizado por outra pessoa",
    );
    assert.equal(moved.document.sections[2].tasks[0].done, true);
    const back = await rpc("pro_apply", [
      key,
      edit,
      {
        type: "move_task",
        sectionId: "last",
        taskId: "a",
        toSectionId: "first",
        beforeId: "c",
        expectedSourceOrder: ["a"],
        expectedTargetOrder: ["b", "c"],
      },
    ]);
    assert.deepEqual(
      back.document.sections[0].tasks.map((t) => t.id),
      ["b", "a", "c"],
    );
    assert.deepEqual(back.document.sections[2].tasks, []);
  });
  it("rejeita ordem desatualizada e destinos inexistentes sem remover itens", async () => {
    const key = await setup();
    const op = {
      type: "move_task",
      sectionId: "first",
      taskId: "a",
      toSectionId: "empty",
      beforeId: "não-existe",
      expectedSourceOrder: ["a", "b", "c"],
      expectedTargetOrder: [],
    };
    await assert.rejects(rpc("pro_apply", [key, edit, op]), /CONFLICT/);
    assert.deepEqual((await rpc("pro_read", [key, edit])).document, initial);
    await assert.rejects(
      rpc("pro_apply", [
        key,
        edit,
        { ...op, beforeId: null, expectedSourceOrder: ["a", "b"] },
      ]),
      /CONFLICT/,
    );
    await assert.rejects(
      rpc("pro_apply", [key, "d".repeat(64), { ...op, beforeId: null }]),
      /ACCESS_DENIED/,
    );
  });
  it("não aceita IDs duplicados na seção de destino", async () => {
    const key = await setup();
    await rpc("pro_apply", [
      key,
      edit,
      {
        type: "add_task",
        sectionId: "empty",
        task: { id: "a", text: "Outro item", done: false, comment: "" },
      },
    ]);
    const before = await rpc("pro_read", [key, edit]);
    await assert.rejects(
      rpc("pro_apply", [
        key,
        edit,
        {
          type: "move_task",
          sectionId: "first",
          taskId: "a",
          toSectionId: "empty",
          beforeId: null,
          expectedSourceOrder: ["a", "b", "c"],
          expectedTargetOrder: ["a"],
        },
      ]),
      /CONFLICT/,
    );
    assert.deepEqual(await rpc("pro_read", [key, edit]), before);
  });
  it("aplica o script de atualização sem alterar dados, links ou permissões", async () => {
    const key = await setup();
    const before = await rpc("pro_read", [key, edit]);
    const definition = await db.query<{ definition: string }>(
      "select pg_get_functiondef('public.pro_apply(uuid,text,jsonb)'::regprocedure) as definition",
    );
    const migration = await readFile(
      new URL(
        "../supabase/migrations/20261008_001_ordering.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(
      "reset role;" +
        migration +
        (await readFile(
          new URL(
            "../supabase/migrations/20261009_002_item_details.sql",
            import.meta.url,
          ),
          "utf8",
        )) +
        "set role anon;",
    );
    const afterDefinition = await db.query<{ definition: string }>(
      "select pg_get_functiondef('public.pro_apply(uuid,text,jsonb)'::regprocedure) as definition",
    );
    assert.equal(
      afterDefinition.rows[0].definition,
      definition.rows[0].definition,
    );
    assert.deepEqual(await rpc("pro_read", [key, edit]), before);
    assert.equal((await rpc("pro_read", [key, admin])).role, "admin");
    await assert.rejects(
      db.query("select * from checklist_private.checklists"),
    );
    const moved = await rpc("pro_apply", [
      key,
      edit,
      {
        type: "move_task",
        sectionId: "first",
        taskId: "a",
        toSectionId: "empty",
        beforeId: null,
        expectedSourceOrder: ["a", "b", "c"],
        expectedTargetOrder: [],
      },
    ]);
    assert.equal(moved.document.sections[1].tasks[0].id, "a");
  });
  it("a demonstração também suporta ordenação e transferência", () => {
    const moved = applyOperation(initial, {
      type: "move_task",
      sectionId: "first",
      taskId: "a",
      toSectionId: "empty",
      beforeId: null,
      expectedSourceOrder: ["a", "b", "c"],
      expectedTargetOrder: [],
    });
    assert.deepEqual(moved.sections[1].tasks[0], initial.sections[0].tasks[0]);
    const reordered = applyOperation(moved, {
      type: "move_section",
      sectionId: "empty",
      beforeId: "first",
      expectedOrder: ["first", "empty", "last"],
    });
    assert.equal(reordered.sections[0].id, "empty");
    assert.throws(() =>
      applyOperation(reordered, {
        type: "move_section",
        sectionId: "last",
        beforeId: null,
        expectedOrder: ["first", "empty", "last"],
      }),
    );
  });
});

describe("modelo local e links", () => {
  it("gera e interpreta chaves sem query string", () => {
    const access = { id, token: token() };
    const url = new URL(
      accessLink(access, "https://example.org/app/?secret=1"),
    );
    assert.equal(url.search, "");
    assert.deepEqual(parseAccess(url.hash), { ...access, demo: false });
    assert.equal(parseAccess("#id=errado&key=123"), null);
  });
  it("preserva marcações ao editar outro campo e detecta conflito", () => {
    const done = applyOperation(document, {
      type: "update_task",
      sectionId: "s1",
      taskId: "t1",
      patch: { done: true },
      expected: { done: false },
    });
    const commented = applyOperation(done, {
      type: "update_task",
      sectionId: "s1",
      taskId: "t1",
      patch: { comment: "Observação" },
      expected: { comment: "" },
    });
    assert.equal(commented.sections[0].tasks[0].done, true);
    assert.equal(document.sections[0].tasks[0].done, false);
    assert.throws(() =>
      applyOperation(commented, {
        type: "update_task",
        sectionId: "s1",
        taskId: "t1",
        patch: { comment: "Outro" },
        expected: { comment: "" },
      }),
    );
  });
  it("valida limites e cria um exemplo independente", () => {
    assert.equal(validateDocument(newChecklist("Novo projeto", true)), true);
    assert.equal(validateDocument({ title: " ", sections: [] }), false);
    assert.equal(
      validateDocument({ title: "Título", sections: [null] }),
      false,
    );
  });
});
