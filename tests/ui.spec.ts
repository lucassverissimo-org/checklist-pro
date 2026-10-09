import { test, expect, type Locator, type Page } from "@playwright/test";

async function drag(page: Page, handle: Locator, target: Locator) {
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const destination = await target.boundingBox();
  if (!start || !destination) throw new Error("Alça ou destino ausente");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 + 9,
    start.y + start.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height / 2,
    { steps: 20 },
  );
  await page.mouse.up();
}

test("colaboração em dois navegadores, comentário, conflito e revogação", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Nome do checklist").fill("Organização do evento");
  await page
    .getByRole("button", { name: "Criar checklist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Organização do evento", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compartilhar", exact: true }).click();
  const link = await page.getByLabel("Link para sua equipe").inputValue();
  await expect(
    page.getByRole("img", { name: "QR Code do link de edição" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  second.on("pageerror", (error) => errors.push(error.message));
  await second.goto(link);
  await expect(
    second.getByRole("heading", { name: "Organização do evento", exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("button", { name: "Administração", exact: true }),
  ).toHaveCount(0);
  await second.locator(".task-label").first().click();
  await expect(page.locator(".task input[type=checkbox]").first()).toBeChecked({
    timeout: 10000,
  });
  await page
    .getByRole("button", {
      name: "Adicionar comentário: Definir o que precisa ser feito",
      exact: true,
    })
    .click();
  await page.getByLabel("Seu comentário").fill("Confirmado com a equipe ✅");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    second.getByRole("button", {
      name: "Ver comentário: Definir o que precisa ser feito",
      exact: true,
    }),
  ).toBeVisible({ timeout: 10000 });
  await second
    .getByRole("button", {
      name: "Ver comentário: Definir o que precisa ser feito",
      exact: true,
    })
    .click();
  await expect(second.getByLabel("Seu comentário")).toHaveValue(
    "Confirmado com a equipe ✅",
  );
  await second.keyboard.press("Escape");
  const editButton = "Editar atividade: Combinar os detalhes com a equipe";
  await page.getByRole("button", { name: editButton, exact: true }).click();
  await second.getByRole("button", { name: editButton, exact: true }).click();
  await page
    .getByLabel("Descrição da atividade")
    .fill("Combinar com os fiscais");
  await second
    .getByLabel("Descrição da atividade")
    .fill("Meu rascunho concorrente");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    second.getByText("Outra pessoa alterou este texto."),
  ).toBeVisible({ timeout: 10000 });
  await expect(second.getByLabel("Descrição da atividade")).toHaveValue(
    "Meu rascunho concorrente",
  );
  await expect(
    second.getByRole("button", { name: "Salvar", exact: true }),
  ).toBeDisabled();
  await second
    .getByRole("button", { name: "Usar versão atual", exact: true })
    .click();
  await expect(second.getByLabel("Descrição da atividade")).toHaveValue(
    "Combinar com os fiscais",
  );
  await second.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", { name: "Recolher todas", exact: true })
    .click();
  await expect(page.locator(".task")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expandir todas", exact: true })
    .click();
  await expect(page.locator(".task")).toHaveCount(3);
  await page.screenshot({
    path: "test-results/board-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/board-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Administração", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Gerar novo link", exact: true })
    .click();
  await expect(
    second.getByText("Acesso indisponível", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Compartilhar", exact: true }).click();
  expect(await page.getByLabel("Link para sua equipe").inputValue()).not.toBe(
    link,
  );
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  expect(errors).toEqual([]);
  await secondContext.close();
});

test("demonstração local persiste e permite criar itens no celular", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:5175");
  await expect(
    page.getByText("Demonstração local", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("Nome do checklist").fill("Meu planejamento");
  await page.locator(".example-option input").uncheck();
  await page
    .getByRole("button", { name: "Experimentar checklist", exact: true })
    .click();
  await page.getByLabel("Nova etapa", { exact: true }).fill("Preparação");
  await page.getByLabel("Nova etapa", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Preparação", exact: true }),
  ).toBeVisible();
  const activity = page.getByLabel("Nova atividade em Preparação", {
    exact: true,
  });
  await expect(activity).toBeFocused();
  await activity.fill("Conferir a lista de materiais");
  await activity.press("Enter");
  await expect(activity).toHaveValue("");
  await expect(activity).toBeFocused();
  await page.locator(".task-label").first().click();
  await page.reload();
  await expect(
    page.locator(".task input[type=checkbox]").first(),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Compartilhar", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("inclusão contínua, arraste entre etapas e ordem compartilhada", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByLabel("Nome do checklist").fill("Organização compartilhada");
  await page
    .getByRole("button", { name: "Criar checklist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Organização compartilhada",
      exact: true,
    }),
  ).toBeVisible();
  const add = page.getByLabel("Nova atividade em Antes de começar", {
    exact: true,
  });
  await add.fill("Atividade extra A");
  await add.press("Enter");
  await expect(add).toHaveValue("");
  await expect(add).toBeFocused();
  await add.fill("Atividade extra B");
  await add.press("Enter");
  await expect(add).toHaveValue("");
  await expect(add).toBeFocused();
  await page.getByLabel("Nova etapa", { exact: true }).fill("Destino vazio");
  await page.getByLabel("Nova etapa", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Destino vazio", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compartilhar", exact: true }).click();
  const link = await page.getByLabel("Link para sua equipe").inputValue();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  const context = await browser.newContext();
  const second = await context.newPage();
  await second.goto(link);
  await expect(second.locator(".checklist-section")).toHaveCount(3);
  const first = page.locator(".checklist-section").filter({
    has: page.getByRole("heading", { name: "Antes de começar", exact: true }),
  });
  const destination = page.locator(".checklist-section").filter({
    has: page.getByRole("heading", { name: "Destino vazio", exact: true }),
  });
  await page
    .getByRole("button", {
      name: "Adicionar comentário: Atividade extra A",
      exact: true,
    })
    .click();
  await page.getByLabel("Seu comentário").fill("Levar junto ao mover");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await drag(
    page,
    page.getByRole("button", {
      name: "Mover atividade: Atividade extra B",
      exact: true,
    }),
    first.locator(".task").first(),
  );
  await expect(first.locator(".task-text").first()).toHaveText(
    "Atividade extra B",
  );
  await drag(
    page,
    page.getByRole("button", {
      name: "Mover atividade: Atividade extra A",
      exact: true,
    }),
    destination.locator(".quick-add"),
  );
  await expect(destination.locator(".task-text")).toHaveText([
    "Atividade extra A",
  ]);
  await expect(
    destination.getByRole("button", {
      name: "Ver comentário: Atividade extra A",
      exact: true,
    }),
  ).toBeVisible();
  const remoteDestination = second.locator(".checklist-section").filter({
    has: second.getByRole("heading", { name: "Destino vazio", exact: true }),
  });
  await expect(remoteDestination.locator(".task-text")).toHaveText(
    ["Atividade extra A"],
    { timeout: 10000 },
  );
  await page
    .getByRole("button", { name: "Recolher todas", exact: true })
    .click();
  await drag(
    page,
    page.getByRole("button", {
      name: "Mover etapa Destino vazio",
      exact: true,
    }),
    first.locator(".section-header"),
  );
  await expect(page.locator(".section-toggle h2").first()).toHaveText(
    "Destino vazio",
  );
  await expect(second.locator(".section-toggle h2").first()).toHaveText(
    "Destino vazio",
    { timeout: 10000 },
  );
  await page
    .getByRole("button", { name: "Expandir todas", exact: true })
    .click();
  // Drop into a collapsed destination and confirm it opens after a successful move.
  await destination.locator(".section-toggle").click();
  await drag(
    page,
    page.getByRole("button", {
      name: "Mover atividade: Atividade extra B",
      exact: true,
    }),
    destination.locator(".section-header"),
  );
  await expect(destination.locator(".task-text")).toHaveText([
    "Atividade extra A",
    "Atividade extra B",
  ]);
  await page.getByLabel("Pesquisar atividades").fill("extra");
  await expect(
    page.getByRole("button", {
      name: "Mover atividade: Atividade extra A",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByLabel("Pesquisar atividades").fill("");
  await page.screenshot({
    path: "test-results/quick-add-and-ordering.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".section-toggle h2").first()).toHaveText(
    "Destino vazio",
  );
  await expect(
    page.locator(".checklist-section").first().locator(".task-text"),
  ).toHaveText(["Atividade extra A", "Atividade extra B"]);
  await context.close();
});

test("ordenação por teclado e toque no celular", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("http://localhost:5175");
  await page.getByLabel("Nome do checklist").fill("Lista no celular");
  await page
    .getByRole("button", { name: "Experimentar checklist", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recolher todas", exact: true })
    .click();
  const handle = page.getByRole("button", {
    name: "Mover etapa Antes de começar",
    exact: true,
  });
  await handle.focus();
  await page.keyboard.press("Space", { delay: 150 });
  await expect(page.locator(".drag-preview")).toBeVisible();
  await page.keyboard.press("ArrowDown", { delay: 150 });
  await page.keyboard.press("Space", { delay: 150 });
  await expect(page.locator(".section-toggle h2").first()).toHaveText(
    "Mãos à obra",
  );
  const touchHandle = page.getByRole("button", {
    name: "Mover etapa Mãos à obra",
    exact: true,
  });
  await touchHandle.scrollIntoViewIfNeeded();
  const start = await touchHandle.boundingBox();
  const target = await page
    .getByRole("button", { name: "Mover etapa Antes de começar", exact: true })
    .boundingBox();
  if (!start || !target) throw new Error("Alça não visível");
  const client = await context.newCDPSession(page);
  const x = start.x + start.width / 2,
    y = start.y + start.height / 2;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 12; step++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x, y: y + ((target.y + target.height / 2 - y) * step) / 12 },
      ],
    });
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".section-toggle h2").first()).toHaveText(
    "Antes de começar",
  );
  await page
    .getByRole("button", { name: "Expandir todas", exact: true })
    .click();
  const taskHandle = page.getByRole("button", {
    name: "Mover atividade: Definir o que precisa ser feito",
    exact: true,
  });
  await taskHandle.focus();
  await page.keyboard.press("Space", { delay: 150 });
  await page.keyboard.press("ArrowDown", { delay: 150 });
  await page.keyboard.press("Space", { delay: 150 });
  await expect(
    page.locator(".checklist-section").first().locator(".task-text").first(),
  ).toHaveText("Combinar os detalhes com a equipe");
  await page.screenshot({
    path: "test-results/ordering-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("falha de conexão mantém o texto de inclusão para tentar novamente", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Nome do checklist").fill("Conexão instável");
  await page
    .getByRole("button", { name: "Criar checklist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Conexão instável", exact: true }),
  ).toBeVisible();
  const input = page.getByLabel("Nova atividade em Antes de começar", {
    exact: true,
  });
  await page.route("**/rpc/pro_apply", (route) => route.abort());
  await input.fill("Texto para preservar");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível conectar",
  );
  await expect(input).toHaveValue("Texto para preservar");
  await page.unroute("**/rpc/pro_apply");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(
    page.locator(".task-text").filter({ hasText: "Texto para preservar" }),
  ).toHaveCount(1);
});
