import { expect, test } from "@playwright/test";
import { observeBrowser } from "./support/observability";
import { loginWithQaCredentials } from "./support/auth";

const hasQaCredentials = Boolean(process.env.QA_BASE_URL && process.env.QA_EMAIL && process.env.QA_PASSWORD);

test.describe("autenticação e navegação QA", () => {
  test.skip(!hasQaCredentials, "Defina QA_BASE_URL, QA_EMAIL e QA_PASSWORD somente no ambiente de execução.");

  test("login, refresh, deep link e logout não expõem segredos", async ({ page }, testInfo) => {
    const assertObservability = observeBrowser(page, testInfo, { allowHttpStatuses: [401] });
    await loginWithQaCredentials(page);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Caixa de entrada" })).toBeVisible();
    expect(page.url()).not.toContain(process.env.QA_PASSWORD!);

    await page.getByRole("button", { name: "Menu do usuário" }).click();
    await page.getByRole("button", { name: "Sair do sistema" }).click();
    await expect(page.getByRole("heading", { name: "Acesse seu painel" })).toBeVisible();
    await assertObservability();
  });

  test("rota protegida redireciona sem sessão", async ({ page }, testInfo) => {
    const assertObservability = observeBrowser(page, testInfo, { allowHttpStatuses: [401] });
    await page.goto("/admin/menu-visibilidade");
    await expect(page.getByRole("heading", { name: "Acesse seu painel" })).toBeVisible();
    await assertObservability();
  });
});
