import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { QueryResultRow } from "pg";
import { freeMenuOptionSlot, isMenuOptionConflict } from "../../lib/queue-menu-option";

type QueueRow = { id: string; name: string; menu_option: number };

/**
 * Banco de mentira com o mesmo índice único de produção
 * (`idx_queues_org_menu_option`), para provar que a troca de posições não
 * depende de sorte na ordem dos UPDATEs.
 */
function fakeClient(rows: QueueRow[]) {
  const executed: string[] = [];

  function assertUnique() {
    const options = rows.map((row) => row.menu_option);
    if (new Set(options).size !== options.length) {
      throw Object.assign(new Error('duplicate key value violates unique constraint "idx_queues_org_menu_option"'), {
        code: "23505",
        constraint: "idx_queues_org_menu_option",
      });
    }
  }

  return {
    rows,
    executed,
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
      executed.push(text);
      const result = (found: QueueRow[]) => ({ rows: found as unknown as T[], rowCount: found.length });

      if (text.startsWith("SELECT id, name, menu_option") && text.includes("AND id=$2")) {
        return result(rows.filter((row) => row.id === values[1]));
      }
      if (text.startsWith("SELECT id, name, menu_option") && text.includes("AND menu_option=$2")) {
        return result(rows.filter((row) => row.menu_option === values[1] && row.id !== values[2]));
      }
      if (text.includes("LEAST(COALESCE(MIN(menu_option),0),0)-1")) {
        const target = rows.find((row) => row.id === values[1]);
        if (target) target.menu_option = Math.min(0, ...rows.map((row) => row.menu_option)) - 1;
        assertUnique();
        return { rows: [] as unknown as T[], rowCount: target ? 1 : 0 };
      }
      if (text.startsWith("UPDATE queues SET menu_option=$3")) {
        const target = rows.find((row) => row.id === values[1]);
        if (target) target.menu_option = Number(values[2]);
        assertUnique();
        return { rows: [] as unknown as T[], rowCount: target ? 1 : 0 };
      }

      throw new Error(`Consulta não prevista no teste: ${text}`);
    },
  };
}

test("mover uma fila para posição ocupada troca as duas sem violar o índice único", async () => {
  const client = fakeClient([
    { id: "ofertas", name: "Ofertas e promoções", menu_option: 1 },
    { id: "horarios", name: "Horários e localização", menu_option: 2 },
  ]);

  const swap = await freeMenuOptionSlot(client, "org-1", "ofertas", 2);

  assert.deepEqual(swap, { id: "horarios", name: "Horários e localização", menuOption: 1 });
  // A fila movida fica estacionada; quem grava a posição final é o chamador.
  assert.equal(client.rows.find((row) => row.id === "horarios")?.menu_option, 1);
  assert.ok(Number(client.rows.find((row) => row.id === "ofertas")?.menu_option) < 1);
});

test("troca funciona com fila legada parada na posição zero", async () => {
  // `menu_option` tem DEFAULT 0: a posição de estacionamento precisa ficar
  // abaixo disso, senão a troca colidiria com a linha legada.
  const client = fakeClient([
    { id: "legada", name: "Fila legada", menu_option: 0 },
    { id: "ofertas", name: "Ofertas e promoções", menu_option: 1 },
    { id: "horarios", name: "Horários e localização", menu_option: 2 },
  ]);

  const swap = await freeMenuOptionSlot(client, "org-1", "ofertas", 2);

  assert.equal(swap?.id, "horarios");
  assert.equal(client.rows.find((row) => row.id === "legada")?.menu_option, 0);
});

test("mover para posição livre não desloca ninguém", async () => {
  const client = fakeClient([
    { id: "produtos", name: "Produtos e disponibilidade", menu_option: 10 },
    { id: "acougue", name: "Açougue, padaria e hortifruti", menu_option: 4 },
  ]);

  assert.equal(await freeMenuOptionSlot(client, "org-1", "produtos", 3), null);
  assert.equal(client.executed.filter((sql) => sql.startsWith("UPDATE")).length, 0);
});

test("salvar a fila na mesma posição não executa troca", async () => {
  const client = fakeClient([{ id: "atendente", name: "Falar com um atendente", menu_option: 6 }]);

  assert.equal(await freeMenuOptionSlot(client, "org-1", "atendente", 6), null);
  assert.equal(client.executed.length, 1);
});

test("colisão de posição é reconhecida para virar 409 na API", () => {
  assert.equal(
    isMenuOptionConflict({ code: "23505", constraint: "idx_queues_org_menu_option", message: "duplicate key" }),
    true,
  );
  assert.equal(isMenuOptionConflict({ code: "23505", message: "duplicate key on users_email" }), false);
  assert.equal(isMenuOptionConflict(new Error("timeout")), false);
});

test("a posição no menu salva no editor de automação chega à tabela queues", async () => {
  const [service, drawer] = await Promise.all([
    readFile("lib/queue-automation.ts", "utf8"),
    readFile("frontend/components/Admin/QueueAutomationDrawer.tsx", "utf8"),
  ]);
  const saveDraft = service.slice(
    service.indexOf("export async function saveQueueAutomationDraft"),
    service.indexOf("async function validatePublish"),
  );

  // Sem este UPDATE o número configurado ficaria só em queue_configurations,
  // invisível para o card do painel e para o menu enviado ao cliente.
  assert.match(saveDraft, /UPDATE queues SET name=\$3,menu_option=\$4/);
  assert.match(saveDraft, /freeMenuOptionSlot/);
  assert.match(drawer, /onChanged\(\)/);
});
