import { expect, test } from "@playwright/test";
import { loginWithQaCredentials } from "./support/auth";
import { observeBrowser } from "./support/observability";

const hasQaCredentials = Boolean(process.env.QA_BASE_URL && process.env.QA_EMAIL && process.env.QA_PASSWORD);

test.describe("navegação operacional autenticada", () => {
  test.skip(!hasQaCredentials, "Defina QA_BASE_URL, QA_EMAIL e QA_PASSWORD somente no ambiente de execução.");

  test("navega por Inbox e Contatos sem perder título, URL ou item ativo", async ({ page }, testInfo) => {
    const assertObservability = observeBrowser(page, testInfo, {
      allowHttpStatuses: [401],
      // O WebKit reporta fetches cancelados pela própria navegação como pageerror.
      // Uma auditoria separada mantém o Inbox parado e continua cobrindo CORS real.
      allowWebKitNavigationAborts: true,
    });
    await loginWithQaCredentials(page);

    const inboxNavigation = page.getByRole("button", { name: "Inbox", exact: true });
    await expect(inboxNavigation).toHaveClass(/bg-blue-600/);
    await expect(page.locator("header h1")).toHaveText("Caixa de entrada");

    const contactsNavigation = page.getByRole("button", { name: "Contatos", exact: true });
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Abrir navegação" }).click();
      await expect(contactsNavigation).toBeVisible();
    }
    await contactsNavigation.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/contacts$/);
    await expect(page.locator("header h1")).toHaveText("Relacionamento com clientes");
    await expect(contactsNavigation).toHaveClass(/bg-blue-600/);

    await page.reload();
    await expect(page.locator("header h1")).toHaveText("Relacionamento com clientes");
    await page.goto("/inbox");
    await expect(page.locator("header h1")).toHaveText("Caixa de entrada");
    await assertObservability();
  });
});
