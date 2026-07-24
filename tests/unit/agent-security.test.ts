import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalAgentRequest,
  decryptAgentSecret,
  encryptAgentSecret,
  recordsChecksum,
  signAgentRequest,
  stableJson,
  verifyAgentSignature,
} from "../../lib/agent-cloud/agent-signature";
import { assertRecordsChecksum } from "../../lib/agent-cloud/agent-idempotency";
import {
  heartbeatPayloadSchema,
  salesDailyPayloadSchema,
} from "../../lib/agent-cloud/agent-payload-schemas";

const request = {
  method: "POST",
  path: "/api/agent/v1/heartbeat",
  timestamp: "1784818800",
  nonce: "nonce-with-16-chars",
  rawBody: '{"schemaVersion":"1.0"}',
};

test("assinatura HMAC cobre método, caminho, timestamp, nonce e corpo", () => {
  const signature = signAgentRequest("segredo-individual", request);
  assert.equal(signature.length, 64);
  assert.equal(
    verifyAgentSignature("segredo-individual", signature, request),
    true,
  );
  assert.equal(
    verifyAgentSignature("segredo-individual", signature, {
      ...request,
      path: "/api/agent/v1/config",
    }),
    false,
  );
  assert.equal(canonicalAgentRequest(request).split("\n").length, 5);
});

test("segredo do agente é cifrado com AES-GCM e recuperado", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptAgentSecret("segredo-por-agente", key);
  assert.notEqual(encrypted.ciphertext, "segredo-por-agente");
  assert.equal(
    decryptAgentSecret(
      {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      key,
    ),
    "segredo-por-agente",
  );
});

test("checksum é estável e rejeita alteração de registros", () => {
  const records = [{ b: 2, a: 1 }];
  assert.equal(stableJson(records), '[{"a":1,"b":2}]');
  const checksum = recordsChecksum(records);
  assert.doesNotThrow(() => assertRecordsChecksum(records, checksum));
  assert.throws(
    () => assertRecordsChecksum([{ a: 2, b: 2 }], checksum),
    /não confere/,
  );
});

test("schemas recusam versão incompatível, campos extras e datas fora do lote", () => {
  assert.equal(
    heartbeatPayloadSchema.safeParse({
      schemaVersion: "2.0",
      agentVersion: "0.1.0",
      generatedAt: "2026-07-23T12:00:00-03:00",
      sourceTimezone: "America/Sao_Paulo",
    }).success,
    false,
  );

  const record = {
    saleDate: "2026-07-24",
    grossTotal: 100,
    netTotal: 100,
    discountTotal: 0,
    cancelledTotal: 0,
    salesCount: 1,
    itemsQuantity: 1,
    averageTicket: 100,
    sourceUpdatedAt: "2026-07-24T12:00:00-03:00",
  };
  assert.equal(
    salesDailyPayloadSchema.safeParse({
      schemaVersion: "1.0",
      batchId: "079d449d-6a99-4af7-bac8-e1e9f075fbea",
      agentVersion: "0.1.0",
      generatedAt: "2026-07-23T12:00:00-03:00",
      sourceTimezone: "America/Sao_Paulo",
      range: { from: "2026-07-01", to: "2026-07-23" },
      records: [record],
      checksum: recordsChecksum([record]),
    }).success,
    false,
  );
});
