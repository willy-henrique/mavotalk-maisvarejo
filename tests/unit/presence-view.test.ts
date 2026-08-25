import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPresenceUpdate,
  formatLastSeen,
  presenceTotals,
  sortByPresence,
  type TeamPresenceMember,
} from "../../frontend/services/presence";

const AGORA = new Date("2026-08-25T12:00:00Z").getTime();
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

function membro(
  id: string,
  state: TeamPresenceMember["state"],
  openConversations = 0,
  name = id,
): TeamPresenceMember {
  return {
    id,
    name,
    email: `${id}@loja.com`,
    role: "atendente",
    state,
    connections: state === "offline" ? 0 : 1,
    lastSeenAt: new Date(AGORA).toISOString(),
    openConversations,
  };
}

// ---------------------------------------------------------------------------
// Ordenação
// ---------------------------------------------------------------------------

test("quem está online vem primeiro, depois ausente, depois offline", () => {
  const lista = [membro("c", "offline"), membro("a", "ausente"), membro("b", "online")];

  assert.deepEqual(
    sortByPresence(lista).map((m) => m.id),
    ["b", "a", "c"],
  );
});

test("dentro do mesmo estado, quem tem mais atendimento aberto aparece antes", () => {
  // Quem coordena está procurando sobrecarga. Ordenar por nome esconderia o
  // atendente com sete chamados no meio da lista.
  const lista = [membro("leve", "online", 1), membro("pesado", "online", 7)];

  assert.deepEqual(
    sortByPresence(lista).map((m) => m.id),
    ["pesado", "leve"],
  );
});

test("empate de carga cai para ordem alfabética, que é estável entre recargas", () => {
  const lista = [
    membro("z", "online", 2, "Zilda"),
    membro("a", "online", 2, "Ana"),
  ];

  assert.deepEqual(
    sortByPresence(lista).map((m) => m.name),
    ["Ana", "Zilda"],
  );
});

test("ordenar não altera a lista recebida", () => {
  const lista = [membro("b", "offline"), membro("a", "online")];

  sortByPresence(lista);

  assert.deepEqual(lista.map((m) => m.id), ["b", "a"]);
});

// ---------------------------------------------------------------------------
// Atualização pelo socket
// ---------------------------------------------------------------------------

test("o evento do socket atualiza o estado de quem está na lista", () => {
  const lista = [membro("u1", "offline"), membro("u2", "online")];

  const atualizada = applyPresenceUpdate(lista, [
    { userId: "u1", state: "online", lastActivityAt: AGORA, connections: 1 },
  ]);

  assert.equal(atualizada.find((m) => m.id === "u1")?.state, "online");
});

test("quem sumiu do evento volta para offline", () => {
  // O evento carrega a equipe conectada inteira. Quem não está nele fechou o
  // painel — tratar ausência como "sem novidade" deixaria gente eternamente
  // online depois de fechar o navegador.
  const lista = [membro("u1", "online"), membro("u2", "online")];

  const atualizada = applyPresenceUpdate(lista, [
    { userId: "u1", state: "online", lastActivityAt: AGORA, connections: 1 },
  ]);

  assert.equal(atualizada.find((m) => m.id === "u2")?.state, "offline");
  assert.equal(atualizada.find((m) => m.id === "u2")?.connections, 0);
});

test("o evento não inventa gente que não está na equipe carregada", () => {
  // Usuário desativado entre a carga e o evento não deve reaparecer na tela.
  const lista = [membro("u1", "online")];

  const atualizada = applyPresenceUpdate(lista, [
    { userId: "u1", state: "online", lastActivityAt: AGORA, connections: 1 },
    { userId: "desativado", state: "online", lastActivityAt: AGORA, connections: 1 },
  ]);

  assert.deepEqual(atualizada.map((m) => m.id), ["u1"]);
});

test("quem ficou offline preserva o último instante conhecido", () => {
  const visto = new Date(AGORA - 3 * MINUTO).toISOString();
  const lista = [{ ...membro("u1", "online"), lastSeenAt: visto }];

  const atualizada = applyPresenceUpdate(lista, []);

  assert.equal(atualizada[0].lastSeenAt, visto);
});

// ---------------------------------------------------------------------------
// Visto por último
// ---------------------------------------------------------------------------

test("sem registro nenhum, não inventa tempo", () => {
  assert.equal(formatLastSeen(null, AGORA), "nunca entrou");
});

test("menos de um minuto é agora", () => {
  assert.equal(formatLastSeen(new Date(AGORA - 30 * 1000).toISOString(), AGORA), "agora");
});

test("minutos, horas e dias saem em português", () => {
  assert.equal(formatLastSeen(new Date(AGORA - 5 * MINUTO).toISOString(), AGORA), "há 5 min");
  assert.equal(formatLastSeen(new Date(AGORA - 2 * HORA).toISOString(), AGORA), "há 2 h");
  assert.equal(formatLastSeen(new Date(AGORA - 3 * DIA).toISOString(), AGORA), "há 3 dias");
});

test("singular não sai errado", () => {
  assert.equal(formatLastSeen(new Date(AGORA - 1 * MINUTO).toISOString(), AGORA), "há 1 min");
  assert.equal(formatLastSeen(new Date(AGORA - 1 * HORA).toISOString(), AGORA), "há 1 h");
  assert.equal(formatLastSeen(new Date(AGORA - 1 * DIA).toISOString(), AGORA), "há 1 dia");
});

test("relógio adiantado no servidor não vira tempo negativo", () => {
  assert.equal(formatLastSeen(new Date(AGORA + 5 * MINUTO).toISOString(), AGORA), "agora");
});

test("data inválida não quebra a tela", () => {
  assert.equal(formatLastSeen("nao-e-data", AGORA), "nunca entrou");
});

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

test("os totais somam a equipe inteira", () => {
  const lista = [
    membro("a", "online"),
    membro("b", "online"),
    membro("c", "ausente"),
    membro("d", "offline"),
  ];

  assert.deepEqual(presenceTotals(lista), {
    online: 2,
    ausente: 1,
    offline: 1,
    equipe: 4,
  });
});
