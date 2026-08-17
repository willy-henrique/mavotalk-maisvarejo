import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.QA_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:4001";
const productionReadOnly = process.env.QA_PRODUCTION_READONLY === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/e2e-junit.xml" }],
  ],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 25_000,
    // Uma auditoria em produção pode renderizar PII real. Nesse modo, o relatório
    // registra somente metadados sanitizados — nunca screenshot/trace do Inbox.
    screenshot: productionReadOnly ? "off" : "only-on-failure",
    trace: productionReadOnly ? "off" : "retain-on-failure",
    video: "off",
  },
  projects: [
    { name: "desktop-1366", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "desktop-1920", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
});
