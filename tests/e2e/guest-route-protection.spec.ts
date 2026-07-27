import { expect, test } from "@playwright/test";
import { observeBrowser } from "./support/observability";

const hasQaBaseUrl = Boolean(process.env.QA_BASE_URL);

test.describe("proteção de rota sem sessão", () => {
  test.skip(!hasQaBaseUrl, "Defina QA_BASE_URL para executar contra o ambiente QA.");

  test("rota administrativa direta não abre conteúdo sem autenticação", async ({ page }, testInfo) => {
    const assertObservability = observeBrowser(page, testInfo, { allowHttpStatuses: [401] });
    await page.goto("/admin/menu-visibilidade");

    await expect(page.getByRole("heading", { name: "Acesse seu painel" })).toBeVisible();
    await expect(page.getByText("Menu do painel", { exact: true })).not.toBeVisible();
    await assertObservability();
  });
});
