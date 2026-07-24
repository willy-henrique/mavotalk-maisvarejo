import "dotenv/config";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";

const baseUrl = (
  process.env.MAVO_SIM_API_BASE_URL ||
  process.env.MAVO_SIM_AGENT_BASE_URL ||
  "http://localhost:4002"
).replace(/\/$/, "");
const configuredAgentId = process.env.MAVO_SIM_AGENT_ID;
const configuredSecret = process.env.MAVO_SIM_AGENT_SECRET;

if (!configuredAgentId || !configuredSecret) {
  console.error(
    "Configure MAVO_SIM_AGENT_ID e MAVO_SIM_AGENT_SECRET com uma credencial provisionada.",
  );
  process.exit(1);
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function signature(secret, method, path, timestamp, nonce, body) {
  const canonical = [
    method.toUpperCase(),
    path,
    timestamp,
    nonce,
    sha256(body),
  ].join("\n");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

let failures = 0;

async function send(label, options) {
  const method = options.method || "POST";
  const body = options.payload ? JSON.stringify(options.payload) : "";
  const timestamp =
    options.timestamp || String(Math.floor(Date.now() / 1_000));
  const nonce = options.nonce || randomBytes(18).toString("base64url");
  const agentId = options.agentId || configuredAgentId;
  const secret = options.secret || configuredSecret;
  const signed = signature(secret, method, options.path, timestamp, nonce, body);
  const response = await fetch(`${baseUrl}${options.path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Mavo-Agent-Id": agentId,
      "X-Mavo-Timestamp": timestamp,
      "X-Mavo-Nonce": nonce,
      "X-Mavo-Signature": options.invalidSignature
        ? `${signed.slice(0, -1)}${signed.endsWith("0") ? "1" : "0"}`
        : signed,
      ...(options.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : {}),
    },
    body: method === "GET" ? undefined : body,
  });
  const responseBody = await response.json().catch(() => ({}));
  const passed = response.status === (options.expectedStatus || 200);
  if (!passed) failures += 1;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${label}: HTTP ${response.status} (esperado ${options.expectedStatus || 200})`,
    JSON.stringify(responseBody),
  );
  return { response, body: responseBody };
}

const now = new Date();
const date = now.toISOString().slice(0, 10);
const generatedAt = now.toISOString();
const batchId = randomUUID();
const records = [
  {
    saleDate: date,
    grossTotal: 1_280.5,
    netTotal: 1_215.75,
    discountTotal: 64.75,
    cancelledTotal: 0,
    salesCount: 13,
    itemsQuantity: 57,
    averageTicket: 93.5192,
    sourceUpdatedAt: generatedAt,
  },
];
const payload = {
  schemaVersion: "1.0",
  batchId,
  agentVersion: "0.1.0-simulator",
  generatedAt,
  sourceTimezone: "America/Sao_Paulo",
  range: { from: date, to: date },
  records,
  checksum: sha256(stableJson(records)),
};

console.log(`Mavo Agent Simulator -> ${baseUrl}`);
await send("heartbeat válido", {
  path: "/api/agent/v1/heartbeat",
  payload: {
    schemaVersion: "1.0",
    agentVersion: "0.1.0-simulator",
    generatedAt,
    sourceTimezone: "America/Sao_Paulo",
    status: "healthy",
    details: { firebirdConnected: true, pendingBatches: 0 },
  },
});
await send("lote válido", {
  path: "/api/agent/v1/sync/sales-daily",
  payload,
  idempotencyKey: batchId,
});
await send("mesmo lote idempotente", {
  path: "/api/agent/v1/sync/sales-daily",
  payload,
  idempotencyKey: batchId,
});
await send("assinatura incorreta (esperado 401)", {
  path: "/api/agent/v1/heartbeat",
  payload: {
    schemaVersion: "1.0",
    agentVersion: "0.1.0-simulator",
    generatedAt,
    sourceTimezone: "America/Sao_Paulo",
    status: "healthy",
  },
  invalidSignature: true,
  expectedStatus: 401,
});
await send("timestamp expirado (esperado 401)", {
  path: "/api/agent/v1/heartbeat",
  payload: {
    schemaVersion: "1.0",
    agentVersion: "0.1.0-simulator",
    generatedAt,
    sourceTimezone: "America/Sao_Paulo",
    status: "healthy",
  },
  timestamp: String(Math.floor(Date.now() / 1_000) - 3_600),
  expectedStatus: 401,
});
const replayTimestamp = String(Math.floor(Date.now() / 1_000));
const replayNonce = randomBytes(18).toString("base64url");
const replayPayload = {
  schemaVersion: "1.0",
  agentVersion: "0.1.0-simulator",
  generatedAt,
  sourceTimezone: "America/Sao_Paulo",
  status: "healthy",
};
await send("nonce inicial para teste de replay", {
  path: "/api/agent/v1/heartbeat",
  payload: replayPayload,
  timestamp: replayTimestamp,
  nonce: replayNonce,
});
await send("nonce repetido (esperado 409)", {
  path: "/api/agent/v1/heartbeat",
  payload: replayPayload,
  timestamp: replayTimestamp,
  nonce: replayNonce,
  expectedStatus: 409,
});
await send("agente revogado/inexistente (esperado 401)", {
  path: "/api/agent/v1/heartbeat",
  payload: {
    schemaVersion: "1.0",
    agentVersion: "0.1.0-simulator",
    generatedAt,
    sourceTimezone: "America/Sao_Paulo",
    status: "healthy",
  },
  agentId: process.env.MAVO_SIM_REVOKED_AGENT_ID || "agt_revoked_simulator",
  expectedStatus: 401,
});
await send("versão incompatível (esperado 422)", {
  path: "/api/agent/v1/sync/sales-daily",
  payload: { ...payload, schemaVersion: "9.9", batchId: randomUUID() },
  idempotencyKey: randomUUID(),
  expectedStatus: 422,
});

if (failures) {
  console.error(`Simulação concluída com ${failures} cenário(s) divergente(s).`);
  process.exitCode = 1;
} else {
  console.log("Simulação concluída com sucesso. Nenhum segredo foi exibido.");
}
