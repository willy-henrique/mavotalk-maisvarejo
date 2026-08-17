import { expect, type Page, type Request, type TestInfo } from "@playwright/test";

const failingStatuses = new Set([400, 401, 403, 404, 409, 422, 500]);

function isExpectedLongLivedRequest(url: string) {
  return url.includes("/socket.io/") || url.includes("sockjs") || url.includes("favicon");
}

export function isExpectedSocketTeardownConsoleError(message: string) {
  return message.includes("/socket.io/") &&
    message.includes("WebSocket connection") &&
    message.includes("closed before the connection is established");
}

export function isExpectedWebKitNavigationAbortPageError(message: string) {
  return message.startsWith("/") && message.endsWith(" due to access control checks.");
}

export function isExpectedWebKitNavigationCancelledRequest(reason: string) {
  return reason === "Load request cancelled";
}

function sanitizeDiagnostic(value: string) {
  return value
    .replace(/([?&](?:sid|token)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "<phone>");
}

export function observeBrowser(
  page: Page,
  testInfo: TestInfo,
  options: { allowHttpStatuses?: number[]; allowWebKitNavigationAborts?: boolean } = {},
) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const httpFailures: string[] = [];
  // A URL não identifica uma requisição: polling/retries podem usar a mesma URL
  // simultaneamente. Rastrear o objeto evita apagar a entrada errada.
  const pending = new Set<Request>();

  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !isExpectedSocketTeardownConsoleError(message.text())
    ) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (
      options.allowWebKitNavigationAborts &&
      isExpectedWebKitNavigationAbortPageError(error.message)
    ) {
      return;
    }
    pageErrors.push(error.message);
  });
  page.on("request", (request) => pending.add(request));
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => {
    pending.delete(request);
    const reason = request.failure()?.errorText || "unknown";
    // Navegar entre duas rotas da SPA cancela legitimamente o GET da tela anterior.
    if (
      reason.includes("ERR_ABORTED") ||
      isExpectedLongLivedRequest(request.url()) ||
      (options.allowWebKitNavigationAborts && isExpectedWebKitNavigationCancelledRequest(reason))
    ) {
      return;
    }
    httpFailures.push(`request failed: ${request.method()} ${request.url()} (${reason})`);
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
    // `networkidle` já pode estar resolvido quando uma navegação SPA inicia um novo
    // fetch. Espere diretamente as chamadas finitas, sem confundir o long-poll do
    // Socket.IO com vazamento de rede.
    const deadline = Date.now() + 15_000;
    let appPending = [...pending].filter((request) => !isExpectedLongLivedRequest(request.url()));
    while (appPending.length && Date.now() < deadline) {
      await page.waitForTimeout(250);
      appPending = [...pending].filter((request) => !isExpectedLongLivedRequest(request.url()));
    }
    const pendingUrls = appPending.map((request) => request.url());
    await testInfo.attach("browser-observability.txt", {
      body: [
        ...consoleErrors.map((line) => `console.error: ${line}`),
        ...pageErrors.map((line) => `pageerror: ${line}`),
        ...httpFailures,
        ...pendingUrls.map((url) => `pending: ${url}`),
      ].map(sanitizeDiagnostic).join("\n") || "No browser errors captured.",
      contentType: "text/plain",
    });
    expect(consoleErrors, "console errors").toEqual([]);
    expect(pageErrors, "unhandled page errors").toEqual([]);
    expect(httpFailures, "unexpected HTTP/request failures").toEqual([]);
    expect(pendingUrls, "requests left pending").toEqual([]);
  };
}
