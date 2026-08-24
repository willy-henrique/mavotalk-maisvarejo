import test from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_FETCH_LIMIT,
  NO_QUEUE_ID,
  applyInboxFilters,
  formatCount,
  groupByQueue,
  isCountCapped,
  queueChipsFor,
  selectByTab,
  type GroupableConversation,
} from "../../frontend/services/inboxGrouping";

const rh = { id: "q-rh", name: "RH", colorHex: "#A855F7", menuOption: 1 };
const financeiro = { id: "q-fin", name: "Financeiro", colorHex: "#3B82F6", menuOption: 2 };
const delivery = { id: "q-del", name: "Delivery", colorHex: "#22C55E", menuOption: 3 };

function conversa(
  id: string,
  status: GroupableConversation["status"],
  queue: GroupableConversation["queue"],
  assigneeId?: string,
): GroupableConversation {
  return {
    id,
    status,
    queue,
    ticket: assigneeId ? { assignee: { id: assigneeId } } : null,
  };
}

const base: GroupableConversation[] = [
  conversa("c1", "aguardando", rh),
  conversa("c2", "em_atendimento", rh, "user-1"),
  conversa("c3", "em_atendimento", delivery, "user-2"),
  conversa("c4", "aguardando", financeiro),
  conversa("c5", "pendente_cliente", null),
  conversa("c6", "encerrado", delivery, "user-1"),
  conversa("c7", "em_atendimento", delivery, "user-1"),
];

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------

test("aba Abertas traz todo chamado não encerrado, de qualquer dono", () => {
  const abertas = selectByTab(base, "abertas", "user-1");

  assert.deepEqual(abertas.map((c) => c.id), ["c1", "c2", "c3", "c4", "c5", "c7"]);
});

test("aba Minhas traz só os meus em aberto", () => {
  const minhas = selectByTab(base, "minhas", "user-1");

  // c6 é meu, mas está encerrado: pertence a Resolvidos, não à lista de trabalho.
  // c3 está em aberto, mas é do user-2.
  assert.deepEqual(minhas.map((c) => c.id), ["c2", "c7"]);
});

test("aba Minhas de quem nunca puxou nada vem vazia, não vem tudo", () => {
  assert.deepEqual(selectByTab(base, "minhas", "user-sem-nada"), []);
});

test("aba Resolvidos traz encerrados de todo mundo", () => {
  const resolvidos = selectByTab(base, "resolvidos", "user-1");

  assert.deepEqual(resolvidos.map((c) => c.id), ["c6"]);
});

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

test("filtro de status e de fila se combinam, não se substituem", () => {
  const resultado = applyInboxFilters(base, {
    statusFilter: "em_atendimento",
    queueId: delivery.id,
  });

  assert.deepEqual(resultado.map((c) => c.id), ["c3", "c7"]);
});

test("filtrar por SEM FILA isola quem ainda não escolheu opção", () => {
  const resultado = applyInboxFilters(base, {
    statusFilter: null,
    queueId: NO_QUEUE_ID,
  });

  assert.deepEqual(resultado.map((c) => c.id), ["c5"]);
});

test("sem filtro nenhum a lista passa inteira", () => {
  const resultado = applyInboxFilters(base, { statusFilter: null, queueId: null });

  assert.equal(resultado.length, base.length);
});

// ---------------------------------------------------------------------------
// Agrupamento
// ---------------------------------------------------------------------------

test("SEM FILA vem primeiro; as demais seguem a ordem do menu do WhatsApp", () => {
  // Entra fora de ordem de propósito: a ordem da lista não pode definir a dos grupos.
  const grupos = groupByQueue([
    conversa("a", "aguardando", delivery),
    conversa("b", "aguardando", financeiro),
    conversa("c", "aguardando", null),
    conversa("d", "aguardando", rh),
  ]);

  assert.deepEqual(grupos.map((g) => g.name), ["Sem fila", "RH", "Financeiro", "Delivery"]);
  assert.equal(grupos[0].queueId, NO_QUEUE_ID);
});

test("cada grupo conta o que tem dentro", () => {
  const grupos = groupByQueue(selectByTab(base, "abertas", "user-1"));
  const porNome = new Map(grupos.map((g) => [g.name, g.conversations.length]));

  assert.equal(porNome.get("Sem fila"), 1);
  assert.equal(porNome.get("RH"), 2);
  assert.equal(porNome.get("Financeiro"), 1);
  assert.equal(porNome.get("Delivery"), 2);
});

test("grupo vazio não é inventado", () => {
  const grupos = groupByQueue([conversa("x", "aguardando", rh)]);

  assert.deepEqual(grupos.map((g) => g.name), ["RH"]);
});

test("grupo leva a cor cadastrada da fila para o cabeçalho", () => {
  const [grupo] = groupByQueue([conversa("x", "aguardando", rh)]);

  assert.equal(grupo.colorHex, "#A855F7");
});

test("fila sem cor cadastrada não quebra o cabeçalho", () => {
  const [grupo] = groupByQueue([
    conversa("x", "aguardando", { id: "q", name: "Compras", menuOption: 4 }),
  ]);

  assert.ok(grupo.colorHex, "precisa cair para uma cor padrão");
});

// ---------------------------------------------------------------------------
// Chips de fila
// ---------------------------------------------------------------------------

test("chips seguem a mesma ordem dos grupos e trazem o total", () => {
  const chips = queueChipsFor(selectByTab(base, "abertas", "user-1"));

  assert.deepEqual(
    chips.map((chip) => [chip.name, chip.total]),
    [["Sem fila", 1], ["RH", 2], ["Financeiro", 1], ["Delivery", 2]],
  );
});

// ---------------------------------------------------------------------------
// Contador honesto
//
// A API devolve no máximo 80 conversas. Batendo no teto, todo número derivado
// pode ser menor que a realidade — inclusive o de cada fila. Mostrar "12" quando
// podem ser 30 no Delivery levaria a decisão errada de escala da equipe.
// ---------------------------------------------------------------------------

test("abaixo do teto o número é exato", () => {
  assert.equal(isCountCapped(27), false);
  assert.equal(formatCount(12, false), "12");
});

test("no teto o número admite que pode haver mais", () => {
  assert.equal(isCountCapped(CONVERSATION_FETCH_LIMIT), true);
  assert.equal(formatCount(12, true), "12+");
});

test("zero não leva mais, nem no teto", () => {
  // "0+" sugere algo escondido onde existe ausência. A aba Minhas de quem nunca
  // puxou nada exibia exatamente isso.
  assert.equal(formatCount(0, true), "0");
  assert.equal(formatCount(0, false), "0");
});
