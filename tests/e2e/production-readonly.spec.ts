import { expect, test, type Request } from "@playwright/test";
import { loginWithQaCredentials } from "./support/auth";
import {
  isExpectedSocketTeardownConsoleError,
  isExpectedWebKitNavigationAbortPageError,
  isExpectedWebKitNavigationCancelledRequest,
} from "./support/observability";

const enabled = Boolean(
  process.env.QA_PRODUCTION_READONLY === "true" &&
  process.env.QA_BASE_URL &&
  process.env.QA_EMAIL &&
  process.env.QA_PASSWORD,
);

const routes = [
  { path: "/dashboard", title: "Visão de atendimento", endpoint: "/api/dashboard/metrics" },
  { path: "/contacts", title: "Relacionamento com clientes", endpoint: "/api/contacts" },
  { path: "/painel", title: "Central de conexão", endpoint: "/api/whatsapp/status" },
  { path: "/business/sincronizacao", title: "Agentes e sincronização", endpoint: "/api/admin/agents" },
  { path: "/business/auditoria", title: "Auditoria gerencial", endpoint: "/api/business/audit" },
  { path: "/admin/acessos-gerenciais", title: "Acessos gerenciais", endpoint: "/api/admin/business-access" },
  { path: "/admin/usuarios", title: "Equipe", endpoint: "/api/admin/users" },
  { path: "/admin/tipos", title: "Filas e automações", endpoint: "/api/queues" },
  { path: "/admin/pedidos", title: "Pedidos", endpoint: "/api/orders" },
  { path: "/admin/respostas-rapidas", title: "Respostas rápidas", endpoint: "/api/quick-replies" },
  { path: "/admin/menu-visibilidade", title: "Menu do painel", endpoint: "/api/admin/menu-settings" },
  { path: "/inbox", title: "Caixa de entrada", endpoint: "/api/conversations" },
] as const;

const redact = (value: string) => value
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
  .replace(/\+?\d[\d\s().-]{7,}\d/g, "<phone>")
  .replace(/(authorization|bearer|token|sid)=?[^\s&,;]+/gi, "$1=<redacted>")
  .slice(0, 500);

function pathname(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    return "<invalid-url>";
  }
}

function isExpectedPersistentRequest(request: Request) {
  return request.url().includes("/socket.io/");
}

test.describe("auditoria autenticada somente leitura", () => {
  test.skip(!enabled, "Habilite somente com credenciais e autorização explícita para leitura.");
  test.describe.configure({ mode: "serial" });

  test("carrega as áreas operacionais e administrativas sem mutações", async ({ page }, testInfo) => {
    const findings: string[] = [];
    const results: Array<{
      path: string;
      expectedTitle: string;
      renderedTitle: string;
      endpointStatus: number | null;
      endpointMs: number | null;
      horizontalOverflowPx: number;
      visibleErrorStates: number;
    }> = [];
    const requestStartedAt = new Map<Request, number>();
    let currentRoute = "/login";

    page.on("request", (request) => requestStartedAt.set(request, Date.now()));
    page.on("requestfinished", (request) => requestStartedAt.delete(request));
    page.on("requestfailed", (request) => {
      requestStartedAt.delete(request);
      const reason = request.failure()?.errorText || "unknown";
      if (
        reason.includes("ERR_ABORTED") ||
        isExpectedPersistentRequest(request) ||
        isExpectedWebKitNavigationCancelledRequest(reason)
      ) {
        return;
      }
      findings.push(`${currentRoute}: falha de rede em ${pathname(request.url())} (${redact(reason)})`);
    });
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !isExpectedSocketTeardownConsoleError(message.text())
      ) {
        findings.push(`${currentRoute}: console.error: ${redact(message.text())}`);
      }
    });
    page.on("pageerror", (error) => {
      if (isExpectedWebKitNavigationAbortPageError(error.message)) return;
      findings.push(`${currentRoute}: pageerror: ${redact(error.message)}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        findings.push(`${currentRoute}: HTTP ${response.status()} em ${pathname(response.url())}`);
      }
    });

    await loginWithQaCredentials(page);

    for (const route of routes) {
      currentRoute = route.path;
      const startedAt = Date.now();
      const responsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "GET" && url.pathname === route.endpoint;
      }, { timeout: 20_000 }).catch(() => null);

      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      const response = await responsePromise;
      if (response) await response.finished().catch(() => undefined);

      const renderedTitle = (await page.locator("header h1").textContent().catch(() => null))?.trim() || "<ausente>";
      if (renderedTitle !== route.title) {
        findings.push(`${route.path}: cabeçalho esperado “${route.title}”, recebido “${renderedTitle}”`);
      }
      const documentTitle = await page.title();
      if (documentTitle !== `${route.title} | Mavo Talk`) {
        findings.push(`${route.path}: título da aba incorreto (“${redact(documentTitle)}”)`);
      }
      if (!response) findings.push(`${route.path}: ${route.endpoint} não respondeu em 20 s`);
      else if (!response.ok()) findings.push(`${route.path}: ${route.endpoint} respondeu HTTP ${response.status()}`);

      await page.waitForTimeout(350);
      const layout = await page.evaluate(() => ({
        overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      }));
      const visibleErrorStates = await page.locator('section[role="alert"]:visible').count();
      if (layout.overflow > 1) findings.push(`${route.path}: overflow horizontal de ${layout.overflow}px`);
      if (visibleErrorStates) findings.push(`${route.path}: ${visibleErrorStates} estado(s) de erro visível(is)`);

      results.push({
        path: route.path,
        expectedTitle: route.title,
        renderedTitle,
        endpointStatus: response?.status() ?? null,
        endpointMs: response ? Date.now() - startedAt : null,
        horizontalOverflowPx: layout.overflow,
        visibleErrorStates,
      });
    }

    currentRoute = "/inbox (assinatura)";
    const signatureSwitch = page.getByRole("switch", { name: "Alternar assinatura com o nome do atendente" });
    const signatureVisible = await signatureSwitch.waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!signatureVisible) {
      findings.push("/inbox: botão de assinatura não está visível para a conversa selecionada");
    } else {
      const initialSignature = await signatureSwitch.getAttribute("aria-checked");
      await signatureSwitch.click();
      const toggledSignature = await signatureSwitch.getAttribute("aria-checked");
      if (toggledSignature === initialSignature) findings.push("/inbox: botão de assinatura não alternou o estado");
      await signatureSwitch.click();
      const restoredSignature = await signatureSwitch.getAttribute("aria-checked");
      if (restoredSignature !== initialSignature) findings.push("/inbox: botão de assinatura não restaurou o estado original");
    }

    currentRoute = "/inbox (mobile)";
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === "/api/conversations",
    { timeout: 20_000 }).catch(() => null);
    await page.reload({ waitUntil: "domcontentloaded" });
    const mobileConversations = await mobileResponse;
    if (mobileConversations) await mobileConversations.finished().catch(() => undefined);
    if (!mobileConversations?.ok()) findings.push("/inbox (mobile): conversas não carregaram corretamente");
    if (!await page.getByRole("button", { name: "Abrir navegação" }).isVisible().catch(() => false)) {
      findings.push("/inbox (mobile): controle de navegação móvel não está visível");
    }
    const mobileOverflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    if (mobileOverflow > 1) findings.push(`/inbox (mobile): overflow horizontal de ${mobileOverflow}px`);

    await testInfo.attach("production-readonly-summary.json", {
      body: JSON.stringify({ results, mobileOverflow, findings }, null, 2),
      contentType: "application/json",
    });
    console.log(`READONLY_SUMMARY ${JSON.stringify({ results, mobileOverflow, findings })}`);

    expect(findings, "falhas encontradas na auditoria somente leitura").toEqual([]);
  });

  test("mantém a atualização em tempo real estável sem trocar de tela", async ({ page }, testInfo) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !isExpectedSocketTeardownConsoleError(message.text())
      ) {
        browserErrors.push(redact(message.text()));
      }
    });
    page.on("pageerror", (error) => browserErrors.push(redact(error.message)));

    await loginWithQaCredentials(page);
    const realtimeStatus = page.getByText("Atualização em tempo real", { exact: true });
    await expect(realtimeStatus).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(10_000);
    await expect(realtimeStatus).toBeVisible();

    await testInfo.attach("production-realtime-summary.json", {
      body: JSON.stringify({ connected: true, browserErrors }, null, 2),
      contentType: "application/json",
    });
    console.log(`READONLY_REALTIME ${JSON.stringify({ connected: true, browserErrors })}`);

    expect(browserErrors, "erros com o Inbox parado e o tempo real conectado").toEqual([]);
  });
});
