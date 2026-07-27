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
  await submit.click();
  await expect(submit).toBeDisabled();
  await page.waitForURL(/\/inbox$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Caixa de entrada" })).toBeVisible();
}
