import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import qrcode from "qrcode";

const cdpOrigin = process.env.DOCS_CDP_ORIGIN || "http://127.0.0.1:9222";
const frontendOrigin = process.env.DOCS_FRONTEND_ORIGIN || "http://localhost:4173";
const outputDirectory = path.resolve("docs/assets/technical-guide");

const qrDataUrl = await qrcode.toDataURL(
  "WILLTALK-DOCUMENTATION-DEMO-NOT-A-WHATSAPP-SESSION",
  { width: 320, margin: 1 },
);

const user = {
  userId: "user-doc-admin",
  name: "Administrador Demonstração",
  email: "admin@demonstracao.local",
  role: "admin",
};
const localSession = {
  user: {
    id: user.userId,
    name: user.name,
    email: user.email,
    role: "ADMIN",
    status: "ATIVO",
    isOnline: true,
    permissions: ["*"],
  },
  accessToken: null,
  isAuthenticated: true,
};
const now = new Date();
const isoMinutesAgo = (minutes) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

const conversations = [
  {
    id: "c1a2b3c4-1111-4111-8111-111111111111",
    status: "em_atendimento",
    triageCompleted: true,
    createdAt: isoMinutesAgo(42),
    updatedAt: isoMinutesAgo(2),
    contact: {
      id: "contact-1",
      name: "Mariana Souza",
      phoneNumber: "whatsapp:+5562999990001",
      avatarUrl: null,
    },
    queue: { id: "queue-1", name: "Delivery", colorHex: "#2563eb" },
    ticket: { assignee: { name: "Carlos Operador" } },
    messages: [
      {
        id: "message-1",
        content: "Olá, meu pedido ainda não chegou. Pode verificar?",
        direction: "inbound",
        createdAt: isoMinutesAgo(12),
        type: "text",
      },
      {
        id: "message-2",
        content: "Claro, Mariana. Já estou consultando a rota do entregador.",
        direction: "outbound",
        createdAt: isoMinutesAgo(8),
        type: "text",
        authorName: "Carlos Operador",
        externalId: "wa-demo-2",
      },
      {
        id: "message-3",
        content: "Obrigada! O número do pedido é 8452.",
        direction: "inbound",
        createdAt: isoMinutesAgo(2),
        type: "text",
      },
    ],
  },
  {
    id: "d2b3c4d5-2222-4222-8222-222222222222",
    status: "aguardando",
    triageCompleted: true,
    createdAt: isoMinutesAgo(27),
    updatedAt: isoMinutesAgo(7),
    contact: {
      id: "contact-2",
      name: "Rafael Lima",
      phoneNumber: "whatsapp:+5562999990002",
      avatarUrl: null,
    },
    queue: { id: "queue-2", name: "Ofertas e preços", colorHex: "#10b981" },
    ticket: null,
    messages: [
      {
        id: "message-4",
        content: "A promoção do café continua válida hoje?",
        direction: "inbound",
        createdAt: isoMinutesAgo(7),
        type: "text",
      },
    ],
  },
  {
    id: "e3c4d5e6-3333-4333-8333-333333333333",
    status: "aguardando",
    triageCompleted: true,
    createdAt: isoMinutesAgo(19),
    updatedAt: isoMinutesAgo(11),
    contact: {
      id: "contact-3",
      name: "Patrícia Alves",
      phoneNumber: "whatsapp:+5562999990003",
      avatarUrl: null,
    },
    queue: { id: "queue-3", name: "Trocas e devoluções", colorHex: "#f59e0b" },
    ticket: null,
    messages: [
      {
        id: "message-5",
        content: "Preciso trocar um produto que veio danificado.",
        direction: "inbound",
        createdAt: isoMinutesAgo(11),
        type: "text",
      },
    ],
  },
];

const analytics = {
  period: { from: "2026-07-01", to: "2026-07-24", label: "este mês" },
  summary: {
    totals: { netTotal: 428750.9, salesCount: 9384, hasData: true },
    averageTicket: 45.69,
    averagePerDay: 17864.62,
    topProduct: { productName: "Arroz Tipo 1 5 kg", quantity: 1280 },
    bestWeekday: { weekdayName: "Sábado", netTotal: 89210.4 },
    lastDataUpdate: now.toISOString(),
  },
  salesByDay: [
    { date: "24/07", netTotal: 19840, salesCount: 421 },
    { date: "23/07", netTotal: 17520, salesCount: 388 },
    { date: "22/07", netTotal: 18110, salesCount: 402 },
    { date: "21/07", netTotal: 16950, salesCount: 374 },
    { date: "20/07", netTotal: 20340, salesCount: 446 },
    { date: "19/07", netTotal: 24120, salesCount: 501 },
  ],
  salesByWeekday: [
    { weekdayName: "Seg", netTotal: 56210 },
    { weekdayName: "Ter", netTotal: 54890 },
    { weekdayName: "Qua", netTotal: 57440 },
    { weekdayName: "Qui", netTotal: 61120 },
    { weekdayName: "Sex", netTotal: 74890 },
    { weekdayName: "Sáb", netTotal: 89210 },
    { weekdayName: "Dom", netTotal: 34990 },
  ],
  topProducts: [
    { productId: "p1", productName: "Arroz Tipo 1 5 kg", quantity: 1280, netTotal: 35840 },
    { productId: "p2", productName: "Leite integral 1 L", quantity: 1142, netTotal: 6852 },
    { productId: "p3", productName: "Café torrado 500 g", quantity: 824, netTotal: 18128 },
    { productId: "p4", productName: "Óleo de soja 900 ml", quantity: 711, netTotal: 6399 },
  ],
  inventory: [
    { productId: "p1", productName: "Arroz Tipo 1 5 kg", quantityEntered: 420 },
    { productId: "p2", productName: "Leite integral 1 L", quantityEntered: 960 },
    { productId: "p3", productName: "Café torrado 500 g", quantityEntered: 300 },
  ],
  freshness: {
    lastSourceUpdate: now.toISOString(),
    lastAgentSync: isoMinutesAgo(3),
    agentStatus: "online",
  },
};

function responseFor(url, method) {
  const { pathname } = new URL(url);
  if (pathname === "/api/me") return { user };
  if (pathname === "/api/whatsapp/status") {
    return {
      provider: "unofficial",
      state: {
        status: "qr",
        qrDataUrl,
        lastError: null,
        connectedPhone: null,
      },
    };
  }
  if (pathname === "/api/conversations") return { conversations };
  if (pathname === "/api/quick-replies") {
    return {
      quickReplies: [
        { id: "qr-1", name: "Saudação", content: "Olá, {primeiro_nome}! Como posso ajudar?" },
      ],
    };
  }
  if (pathname === "/api/dashboard/metrics") {
    return {
      metrics: {
        totalAguardando: 8,
        totalAtendimento: 5,
        totalEncerrado: 147,
        firstResponseAverageMinutes: 4.8,
        satisfactionAverage: 4.72,
        volumeByDemand: [
          { queueName: "Delivery", colorHex: "#2563eb", total: 52 },
          { queueName: "Ofertas", colorHex: "#10b981", total: 38 },
          { queueName: "Trocas", colorHex: "#f59e0b", total: 31 },
          { queueName: "Cadastro", colorHex: "#8b5cf6", total: 26 },
        ],
      },
    };
  }
  if (pathname === "/api/business/analytics") return analytics;
  if (pathname === "/api/auth/logout") return { ok: true };
  if (method === "OPTIONS") return {};
  return {};
}

const targets = await fetch(`${cdpOrigin}/json`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
assert.ok(target?.webSocketDebuggerUrl, "Chrome CDP page target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

let sequence = 0;
const pending = new Map();
const listeners = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.id) {
    const deferred = pending.get(message.id);
    if (!deferred) return;
    pending.delete(message.id);
    if (message.error) deferred.reject(new Error(message.error.message));
    else deferred.resolve(message.result || {});
    return;
  }
  for (const listener of listeners.get(message.method) || []) {
    listener(message.params || {});
  }
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function on(method, listener) {
  const values = listeners.get(method) || [];
  values.push(listener);
  listeners.set(method, values);
}

on("Fetch.requestPaused", async ({ requestId, request }) => {
  const body = Buffer.from(
    JSON.stringify(responseFor(request.url, request.method)),
  ).toString("base64");
  await send("Fetch.fulfillRequest", {
    requestId,
    responseCode: 200,
    responseHeaders: [
      { name: "Content-Type", value: "application/json; charset=utf-8" },
      { name: "Cache-Control", value: "no-store" },
    ],
    body,
  });
});

await send("Page.enable");
await send("Runtime.enable");
await send("Fetch.enable", {
  patterns: [{ urlPattern: "*://*/api/*", requestStage: "Request" }],
});
await mkdir(outputDirectory, { recursive: true });

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value;
}

async function navigate(route, waitMs = 1_800) {
  await send("Page.navigate", { url: `${frontendOrigin}${route}` });
  await wait(waitMs);
}

async function capture(name) {
  await evaluate(
    "window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0",
  );
  await wait(100);
  const result = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await writeFile(
    path.join(outputDirectory, name),
    Buffer.from(result.data, "base64"),
  );
}

await navigate("/");
await evaluate(
  `localStorage.setItem("willtalk_auth_session", ${JSON.stringify(
    JSON.stringify(localSession),
  )})`,
);

await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await navigate("/inbox");
await capture("03-inbox-desktop-demo.png");

await navigate("/dashboard", 2_500);
await capture("04-atendimento-metricas-demo.png");

await navigate("/business", 2_500);
await capture("05-indicadores-negocio-demo.png");

await navigate("/painel");
await capture("06-whatsapp-administracao-demo.png");

await send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await navigate("/inbox");
const layout = await evaluate(`({
  viewport: innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.scrollWidth
})`);
assert.ok(
  layout.documentWidth <= layout.viewport && layout.bodyWidth <= layout.viewport,
  `Mobile layout overflow: ${JSON.stringify(layout)}`,
);
await evaluate(`document.querySelector('[data-conversation-id]')?.click()`);
await wait(500);
await capture("07-inbox-mobile-demo.png");

console.log(
  JSON.stringify({
    status: "ok",
    outputDirectory,
    screenshots: 5,
    mobileLayout: layout,
  }),
);
socket.close();
