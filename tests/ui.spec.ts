import { test, expect, type Locator, type Page } from "@playwright/test";

test("tema alterna e persiste no celular", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Ativar tema claro" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Ativar tema escuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Ativar tema claro" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Ativar tema claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

async function pasteList(input: Locator, text: string) {
  await input.evaluate((element, text) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

test("lista colada, prioridade, anexos e desfazer sincronizam entre navegadores", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByLabel("Nome do checklist").fill("Detalhes completos");
  await page
    .getByRole("button", { name: "Criar checklist", exact: true })
    .click();
  const input = page.getByLabel("Novo item em Antes de começar", {
    exact: true,
  });
  await pasteList(
    input,
    "1. Comprar material\n2) Conferir sala; • Avisar equipe",
  );
  await expect(page.getByText("Detectamos 3 possíveis itens.")).toBeVisible();
  await expect(page.locator(".task")).toHaveCount(3);
  await page.getByLabel("Item colado 2").fill("Conferir todas as salas");
  await page
    .getByRole("button", { name: "Adicionar 3 itens", exact: true })
    .click();
  await expect(page.locator(".task")).toHaveCount(6);
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "Compartilhar", exact: true }).click();
  const link = await page.getByLabel("Link para sua equipe").inputValue();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  const context = await browser.newContext();
  const second = await context.newPage();
  await second.goto(link);
  await page
    .getByRole("button", {
      name: "Detalhes do item: Comprar material",
      exact: true,
    })
    .click();
  await page.getByLabel("Comentário do item").fill("Documento de referência");
  await page.getByLabel("Prioridade", { exact: true }).selectOption("high");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Prioridade alta", exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("img", { name: "Prioridade alta", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByLabel("Filtrar por prioridade").selectOption("high");
  await expect(page.locator(".task")).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "Mover item: Comprar material",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByLabel("Filtrar por prioridade").selectOption("all");
  await page
    .getByRole("button", {
      name: "Detalhes do item: Comprar material",
      exact: true,
    })
    .click();
  await page.getByLabel("Adicionar anexo", { exact: true }).setInputFiles({
    name: "referencia.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nreference\n%%EOF"),
  });
  await expect(
    page.getByRole("button", { name: "Baixar referencia.pdf", exact: true }),
  ).toBeVisible();
  await second
    .getByRole("button", {
      name: "Detalhes do item: Comprar material",
      exact: true,
    })
    .click();
  await expect(
    second.getByRole("button", { name: "Baixar referencia.pdf", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const downloaded = second.waitForEvent("download");
  await second
    .getByRole("button", { name: "Baixar referencia.pdf", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe("referencia.pdf");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/item-details-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Excluir item: Comprar material",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".task")).toHaveCount(5);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.locator(".task")).toHaveCount(6);
  await page
    .getByRole("button", {
      name: "Detalhes do item: Comprar material",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Comentário do item")).toHaveValue(
    "Documento de referência",
  );
  await expect(
    page.getByRole("button", { name: "Baixar referencia.pdf", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Excluir anexo referencia.pdf", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Baixar referencia.pdf", exact: true }),
  ).toHaveCount(0);
  await context.close();
});

test("demonstração preserva anexos locais e permite manter lista como um item", async ({
  page,
}) => {
  await page.goto("http://localhost:5175");
  await page.getByLabel("Nome do checklist").fill("Arquivos locais");
  await page
    .getByRole("button", { name: "Experimentar checklist", exact: true })
    .click();
  const input = page.getByLabel("Novo item em Antes de começar", {
    exact: true,
  });
  await pasteList(input, "Um texto; com duas partes");
  await page
    .getByRole("button", { name: "Manter como um item", exact: true })
    .click();
  await input.press("Enter");
  await expect(page.locator(".task")).toHaveCount(4);
  await page
    .getByRole("button", {
      name: "Detalhes do item: Um texto; com duas partes",
      exact: true,
    })
    .click();
  await page.getByLabel("Adicionar anexo", { exact: true }).setInputFiles({
    name: "local.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nlocal"),
  });
  await expect(
    page.getByRole("button", { name: "Baixar local.pdf", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Adicionar anexo", { exact: true }).setInputFiles({
    name: "miniatura.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect
    .poll(() =>
      page
        .getByAltText("Miniatura de miniatura.png")
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await expect(page.locator(".attachment-thumbnail")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Abrir imagem miniatura.png" })
    .click();
  const viewer = page.getByRole("dialog", {
    name: "miniatura.png",
    exact: true,
  });
  await expect
    .poll(() =>
      viewer
        .getByAltText("miniatura.png", { exact: true })
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await viewer.getByRole("button", { name: "Aumentar zoom" }).click();
  await expect(viewer.getByLabel("Zoom da imagem")).toHaveText("125%");
  await viewer.getByRole("button", { name: "Ajustar" }).click();
  const surface = viewer.locator(".image-viewport");
  const bounds = (await surface.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 50, y, id: 1 },
      { x: x + 50, y, id: 2 },
    ],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 100, y, id: 1 },
      { x: x + 100, y, id: 2 },
    ],
  });
  await expect(viewer.getByLabel("Zoom da imagem")).toHaveText("200%");
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await touch.detach();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Abrir imagem miniatura.png" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Excluir item: Um texto; com duas partes",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", {
      name: "Detalhes do item: Um texto; com duas partes",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Baixar local.pdf", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar local.pdf", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("local.pdf");
  await expect
    .poll(() =>
      page
        .getByAltText("Miniatura de miniatura.png")
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
});

test("edita checklist, seção e item sem modal no computador e celular", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Nome do checklist").fill("Edição na página");
  await page
    .getByRole("button", { name: "Criar checklist", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Renomear checklist", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByLabel("Nome do checklist").fill("Nome atualizado");
  await page.getByLabel("Nome do checklist").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Nome atualizado", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Renomear seção Antes de começar",
      exact: true,
    })
    .click();
  await page.getByLabel("Nome da seção").fill("Preparação");
  await page.getByLabel("Nome da seção").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Preparação", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", {
      name: "Editar item: Definir o que precisa ser feito",
      exact: true,
    })
    .click();
  await page.getByLabel("Descrição do item").fill("Rascunho descartado");
  await page
    .getByRole("button", {
      name: "Editar item: Definir o que precisa ser feito",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Descrição do item")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Editar item: Definir o que precisa ser feito",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Descrição do item")
    .fill("Primeira linha\nSegunda linha");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/edit-inline-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.locator(".task-text").first()).toHaveText(
    "Primeira linha\nSegunda linha",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Nome atualizado", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Preparação", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".task-text").first()).toHaveText(
    "Primeira linha\nSegunda linha",
  );
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page
    .getByRole("button", { name: "Administração", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Excluir checklist", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Criar checklist", exact: true }),
  ).toBeVisible();
  expect(dialogs).toEqual([]);
});

test("comentário inline preserva conflito e exclusão direta no celular", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByLabel("Nome do checklist").fill("Edição sem modal");
  await page
    .getByRole("button", { name: "Criar checklist", exact: true })
    .click();
  await page.getByRole("button", { name: "Compartilhar", exact: true }).click();
  const link = await page.getByLabel("Link para sua equipe").inputValue();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  const context = await browser.newContext();
  const second = await context.newPage();
  await second.goto(link);
  const comment = "Detalhes do item: Definir o que precisa ser feito";
  await page.getByRole("button", { name: comment, exact: true }).click();
  await second.getByRole("button", { name: comment, exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByLabel("Comentário do item").fill("Comentário da equipe");
  await second.getByLabel("Comentário do item").fill("Meu rascunho");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    second.getByText("Outra pessoa alterou este comentário."),
  ).toBeVisible({ timeout: 10000 });
  await expect(second.getByLabel("Comentário do item")).toHaveValue(
    "Meu rascunho",
  );
  await expect(
    second.getByRole("button", { name: "Salvar", exact: true }),
  ).toBeDisabled();
  await second
    .getByRole("button", { name: "Usar versão atual", exact: true })
    .click();
  await expect(second.getByLabel("Comentário do item")).toHaveValue(
    "Comentário da equipe",
  );
  await second.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", {
      name: "Detalhes do item: Definir o que precisa ser feito",
      exact: true,
    })
    .click();
  await page.screenshot({
    path: "test-results/inline-comment-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Excluir item: Definir o que precisa ser feito",
      exact: true,
    })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator(".task")).toHaveCount(2);
  await expect(second.locator(".task")).toHaveCount(2, { timeout: 10000 });
  await page
    .getByRole("button", {
      name: "Excluir seção Antes de começar",
      exact: true,
    })
    .click();
  await expect(page.locator(".checklist-section")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".checklist-section")).toHaveCount(1);
  await context.close();
});

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
      name: "Detalhes do item: Definir o que precisa ser feito",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Comentário do item")
    .fill("Confirmado com a equipe ✅");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    second.getByRole("button", {
      name: "Detalhes do item: Definir o que precisa ser feito",
      exact: true,
    }),
  ).toBeVisible({ timeout: 10000 });
  await second
    .getByRole("button", {
      name: "Detalhes do item: Definir o que precisa ser feito",
      exact: true,
    })
    .click();
  await expect(second.getByLabel("Comentário do item")).toHaveValue(
    "Confirmado com a equipe ✅",
  );
  await second.keyboard.press("Escape");
  const editButton = "Editar item: Combinar os detalhes com a equipe";
  await page.getByRole("button", { name: editButton, exact: true }).click();
  await second.getByRole("button", { name: editButton, exact: true }).click();
  await page.getByLabel("Descrição do item").fill("Combinar com os fiscais");
  await second.getByLabel("Descrição do item").fill("Meu rascunho concorrente");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    second.getByText("Outra pessoa alterou este texto."),
  ).toBeVisible({ timeout: 10000 });
  await expect(second.getByLabel("Descrição do item")).toHaveValue(
    "Meu rascunho concorrente",
  );
  await expect(
    second.getByRole("button", { name: "Salvar", exact: true }),
  ).toBeDisabled();
  await second
    .getByRole("button", { name: "Usar versão atual", exact: true })
    .click();
  await expect(second.getByLabel("Descrição do item")).toHaveValue(
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
  await page.getByLabel("Nova seção", { exact: true }).fill("Preparação");
  await page.getByLabel("Nova seção", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Preparação", exact: true }),
  ).toBeVisible();
  const activity = page.getByLabel("Novo item em Preparação", {
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

test("inclusão contínua, arraste entre seções e ordem compartilhada", async ({
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
  const add = page.getByLabel("Novo item em Antes de começar", {
    exact: true,
  });
  await add.fill("Item extra A");
  await add.press("Enter");
  await expect(add).toHaveValue("");
  await expect(add).toBeFocused();
  await add.fill("Item extra B");
  await add.press("Enter");
  await expect(add).toHaveValue("");
  await expect(add).toBeFocused();
  await page.getByLabel("Nova seção", { exact: true }).fill("Destino vazio");
  await page.getByLabel("Nova seção", { exact: true }).press("Enter");
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
      name: "Detalhes do item: Item extra A",
      exact: true,
    })
    .click();
  await page.getByLabel("Comentário do item").fill("Levar junto ao mover");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await drag(
    page,
    page.getByRole("button", {
      name: "Mover item: Item extra B",
      exact: true,
    }),
    first.locator(".task").first(),
  );
  await expect(first.locator(".task-text").first()).toHaveText("Item extra B");
  await drag(
    page,
    page.getByRole("button", {
      name: "Mover item: Item extra A",
      exact: true,
    }),
    destination.locator(".quick-add"),
  );
  await expect(destination.locator(".task-text")).toHaveText(["Item extra A"]);
  await expect(
    destination.getByRole("button", {
      name: "Detalhes do item: Item extra A",
      exact: true,
    }),
  ).toBeVisible();
  const remoteDestination = second.locator(".checklist-section").filter({
    has: second.getByRole("heading", { name: "Destino vazio", exact: true }),
  });
  await expect(remoteDestination.locator(".task-text")).toHaveText(
    ["Item extra A"],
    { timeout: 10000 },
  );
  await page
    .getByRole("button", { name: "Recolher todas", exact: true })
    .click();
  await drag(
    page,
    page.getByRole("button", {
      name: "Mover seção Destino vazio",
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
      name: "Mover item: Item extra B",
      exact: true,
    }),
    destination.locator(".section-header"),
  );
  await expect(destination.locator(".task-text")).toHaveText([
    "Item extra A",
    "Item extra B",
  ]);
  await page.getByLabel("Pesquisar itens").fill("extra");
  await expect(
    page.getByRole("button", {
      name: "Mover item: Item extra A",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByLabel("Pesquisar itens").fill("");
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
  ).toHaveText(["Item extra A", "Item extra B"]);
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
    name: "Mover seção Antes de começar",
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
    name: "Mover seção Mãos à obra",
    exact: true,
  });
  await touchHandle.scrollIntoViewIfNeeded();
  const start = await touchHandle.boundingBox();
  const target = await page
    .getByRole("button", { name: "Mover seção Antes de começar", exact: true })
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
    name: "Mover item: Definir o que precisa ser feito",
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
  const input = page.getByLabel("Novo item em Antes de começar", {
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
