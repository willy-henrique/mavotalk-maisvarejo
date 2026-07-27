import { expect, type Page, type TestInfo } from "@playwright/test";

const failingStatuses = new Set([400, 401, 403, 404, 409, 422, 500]);

export function observeBrowser(
  page: Page,
  testInfo: TestInfo,
  options: { allowHttpStatuses?: number[] } = {},
) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const httpFailures: string[] = [];
  const pending = new Set<string>();

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => pending.add(request.url()));
  page.on("requestfinished", (request) => pending.delete(request.url()));
  page.on("requestfailed", (request) => {
    pending.delete(request.url());
    httpFailures.push(`request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText || "unknown"})`);
  });
  page.on("response", (response) => {
    if (
      failingStatuses.has(response.status()) &&
      !options.allowHttpStatuses?.includes(response.status())
    ) {
      httpFailures.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`);
    }
  });

  return async () => {
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const appPending = [...pending].filter((url) => !url.includes("favicon") && !url.includes("sockjs"));
    await testInfo.attach("browser-observability.txt", {
      body: [
        ...consoleErrors.map((line) => `console.error: ${line}`),
        ...pageErrors.map((line) => `pageerror: ${line}`),
        ...httpFailures,
        ...appPending.map((url) => `pending: ${url}`),
      ].join("\n") || "No browser errors captured.",
      contentType: "text/plain",
    });
    expect(consoleErrors, "console errors").toEqual([]);
    expect(pageErrors, "unhandled page errors").toEqual([]);
    expect(httpFailures, "unexpected HTTP/request failures").toEqual([]);
    expect(appPending, "requests left pending").toEqual([]);
  };
}
