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

  test("login exige campos e alterna visibilidade da senha sem enviar dados", async ({ page }, testInfo) => {
    const assertObservability = observeBrowser(page, testInfo);
    await page.goto("/inbox");

    const email = page.getByLabel("E-mail corporativo");
    const password = page.getByLabel("Senha");
    expect(await email.evaluate((input) => (input as HTMLInputElement).validity.valid)).toBe(false);
    expect(await password.evaluate((input) => (input as HTMLInputElement).validity.valid)).toBe(false);
    await expect(password).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Mostrar" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Ocultar" }).click();
    await expect(password).toHaveAttribute("type", "password");
    await assertObservability();
  });
});
