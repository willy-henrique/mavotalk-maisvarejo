import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  acquireMigrationLock,
  applyMigrationSessionGuards,
  runWithDeadline,
} from "../../scripts/db-common.mjs";

type QueryLog = { text: string; values?: readonly unknown[] };

function fakeClient(
  responder?: (text: string) => { rows: Array<Record<string, unknown>> },
) {
  const queries: QueryLog[] = [];
  return {
    queries,
    async query(text: string, values?: readonly unknown[]) {
      queries.push({ text: String(text), values });
      return responder?.(String(text)) ?? { rows: [], rowCount: 0 };
    },
  };
}

test("adquire o lock de migration sem bloquear quando ele está livre", async () => {
  const client = fakeClient((text) =>
    text.includes("pg_try_advisory_lock")
      ? { rows: [{ acquired: true }] }
      : { rows: [] },
  );

  await acquireMigrationLock(client, { attempts: 3, waitMs: 0 });

  const sql = client.queries.map((query) => query.text).join("\n");
  assert.match(sql, /pg_try_advisory_lock/);
  // A variante bloqueante é justamente a que prendia o build para sempre.
  assert.doesNotMatch(sql, /SELECT pg_advisory_lock\(/);
});

test("espera o lock enquanto outro deploy ainda o segura", async () => {
  let tentativas = 0;
  const client = fakeClient(() => {
    tentativas += 1;
    return { rows: [{ acquired: tentativas >= 3 }] };
  });

  await acquireMigrationLock(client, { attempts: 5, waitMs: 0 });

  assert.equal(tentativas, 3);
});

test("falha rápido em vez de deixar o deploy travado quando o lock nunca é liberado", async () => {
  const client = fakeClient(() => ({ rows: [{ acquired: false }] }));

  await assert.rejects(
    () => acquireMigrationLock(client, { attempts: 4, waitMs: 0 }),
    /MIGRATION_LOCK_BUSY/,
  );
  assert.equal(client.queries.length, 4);
});

test("sessão de migration limita lock, statement e transação ociosa", async () => {
  const client = fakeClient();

  await applyMigrationSessionGuards(client);

  const sql = client.queries.map((query) => query.text).join("\n");
  assert.match(sql, /SET lock_timeout/);
  assert.match(sql, /SET statement_timeout/);
  assert.match(sql, /SET idle_in_transaction_session_timeout/);
});

test("cada etapa de banco aborta ao estourar o prazo em vez de pendurar o build", async () => {
  await assert.rejects(
    () =>
      runWithDeadline("etapa-de-teste", () => new Promise(() => {}), {
        deadlineMs: 20,
      }),
    /DEADLINE_EXCEEDED/,
  );

  assert.equal(
    await runWithDeadline("etapa-rapida", async () => "pronto", {
      deadlineMs: 1_000,
    }),
    "pronto",
  );
});

test("scripts de deploy não usam mais chamadas de banco sem limite de tempo", async () => {
  const [common, migrate, verify, bootstrap, slaWorker] = await Promise.all([
    readFile("scripts/db-common.mjs", "utf8"),
    readFile("scripts/db-migrate.mjs", "utf8"),
    readFile("scripts/db-verify.mjs", "utf8"),
    readFile("scripts/db-bootstrap-production.mjs", "utf8"),
    readFile("lib/sla-worker.mjs", "utf8"),
  ]);

  assert.match(common, /connectionTimeoutMillis/);
  assert.match(common, /keepAlive/);
  // runDeployStep aplica o prazo e força a saída do processo: só rejeitar a
  // promise não bastaria, porque um socket pendurado segura o event loop.
  assert.match(common, /process\.exit\(/);
  for (const script of [migrate, verify, bootstrap]) {
    assert.match(script, /runDeployStep/);
    assert.match(script, /applyMigrationSessionGuards/);
  }
  assert.match(migrate, /acquireMigrationLock/);
  assert.doesNotMatch(migrate, /SELECT pg_advisory_lock\(/);
  // O pool do worker de SLA também abria conexão sem teto de espera.
  assert.match(slaWorker, /connectionTimeoutMillis/);
});
