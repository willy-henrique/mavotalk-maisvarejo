import { expect, type Page } from "@playwright/test";

export async function loginWithQaCredentials(page: Page) {
  const email = process.env.QA_EMAIL;
  const password = process.env.QA_PASSWORD;
  if (!email || !password) throw new Error("Credenciais QA ausentes no ambiente de execução.");

  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Acesse seu painel" })).toBeVisible();
  await page.getByLabel("E-mail corporativo").fill(email);
  await page.getByLabel("Senha").fill(password);
  const submit = page.getByRole("button", { name: "Entrar no painel" });
  await Promise.all([
    page.waitForURL(/\/inbox$/, { timeout: 20_000 }),
    submit.click(),
  ]);
  await expect(page.locator("header").getByRole("heading", { name: "Caixa de entrada" })).toBeVisible();
}
