import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type PresenceState = "online" | "ausente" | "offline";

type PresenceEntry = {
  userId: string;
  state: PresenceState;
  lastActivityAt: number;
  connections: number;
};

type Registry = {
  connect(input: { organizationId: string; userId: string; socketId: string; at: number }): void;
  activity(input: { organizationId: string; userId: string; at: number }): void;
  disconnect(input: {
    organizationId: string;
    userId: string;
    socketId: string;
    at: number;
  }): { stillConnected: boolean; lastActivityAt: number };
  stateOf(input: { organizationId: string; userId: string; at: number }): PresenceState;
  snapshot(input: { organizationId: string; at: number }): PresenceEntry[];
};

const {
  createPresenceRegistry,
  IDLE_AFTER_MS,
}: {
  createPresenceRegistry(options?: { idleAfterMs?: number }): Registry;
  IDLE_AFTER_MS: number;
} = require("../../lib/presence.cjs");

const ORG = "org-1";
const MINUTE = 60 * 1000;
const T0 = 1_756_000_000_000;

function registry() {
  return createPresenceRegistry();
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

test("quem nunca conectou está offline", () => {
  assert.equal(registry().stateOf({ organizationId: ORG, userId: "u1", at: T0 }), "offline");
});

test("conectar deixa online", () => {
  const presence = registry();
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s1", at: T0 });

  assert.equal(presence.stateOf({ organizationId: ORG, userId: "u1", at: T0 }), "online");
});

test("conectado sem interagir passa a ausente depois do limite", () => {
  // Aba aberta a noite inteira não é atendente disponível. Sem este estado o
  // painel distribuiria chamado para quem foi embora e deixou o Chrome ligado.
  const presence = registry();
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s1", at: T0 });

  const aindaOnline = T0 + IDLE_AFTER_MS - 1;
  const jaAusente = T0 + IDLE_AFTER_MS + 1;

  assert.equal(presence.stateOf({ organizationId: ORG, userId: "u1", at: aindaOnline }), "online");
  assert.equal(presence.stateOf({ organizationId: ORG, userId: "u1", at: jaAusente }), "ausente");
});

test("interagir traz de volta para online", () => {
  const presence = registry();
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s1", at: T0 });
  const ausenteEm = T0 + 10 * MINUTE;
  assert.equal(presence.stateOf({ organizationId: ORG, userId: "u1", at: ausenteEm }), "ausente");

  presence.activity({ organizationId: ORG, userId: "u1", at: ausenteEm });

  assert.equal(presence.stateOf({ organizationId: ORG, userId: "u1", at: ausenteEm }), "online");
});

test("atividade de quem não está conectado não inventa presença", () => {
  // Um ping atrasado, chegando depois do disconnect, não pode ressuscitar
  // alguém que já fechou o painel.
  const presence = registry();
  presence.activity({ organizationId: ORG, userId: "u1", at: T0 });

  assert.equal(presence.stateOf({ organizationId: ORG, userId: "u1", at: T0 }), "offline");
});

// ---------------------------------------------------------------------------
// Várias abas
// ---------------------------------------------------------------------------

test("fechar uma aba não derruba quem ainda tem outra aberta", () => {
  const presence = registry();
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s1", at: T0 });
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s2", at: T0 });

  const saida = presence.disconnect({
    organizationId: ORG,
    userId: "u1",
    socketId: "s1",
    at: T0 + MINUTE,
  });

  assert.equal(saida.stillConnected, true);
  assert.equal(presence.stateOf({ organizationId: ORG, userId: "u1", at: T0 + MINUTE }), "online");
});

test("fechar a última aba deixa offline e devolve o instante para gravar", () => {
  const presence = registry();
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s1", at: T0 });

  const saida = presence.disconnect({
    organizationId: ORG,
    userId: "u1",
    socketId: "s1",
    at: T0 + MINUTE,
  });

  assert.equal(saida.stillConnected, false);
  assert.equal(saida.lastActivityAt, T0 + MINUTE);
  assert.equal(presence.stateOf({ organizationId: ORG, userId: "u1", at: T0 + MINUTE }), "offline");
});

test("desconectar a mesma aba duas vezes não zera quem continua conectado", () => {
  // Socket.io pode emitir disconnect mais de uma vez em reconexão instável.
  const presence = registry();
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s1", at: T0 });
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s2", at: T0 });

  presence.disconnect({ organizationId: ORG, userId: "u1", socketId: "s1", at: T0 });
  const repetido = presence.disconnect({
    organizationId: ORG,
    userId: "u1",
    socketId: "s1",
    at: T0,
  });

  assert.equal(repetido.stillConnected, true);
  assert.equal(presence.stateOf({ organizationId: ORG, userId: "u1", at: T0 }), "online");
});

test("desconectar quem nunca conectou não quebra", () => {
  const saida = registry().disconnect({
    organizationId: ORG,
    userId: "fantasma",
    socketId: "s1",
    at: T0,
  });

  assert.equal(saida.stillConnected, false);
});

// ---------------------------------------------------------------------------
// Snapshot e isolamento
// ---------------------------------------------------------------------------

test("snapshot traz só quem tem conexão, com o estado resolvido", () => {
  const presence = registry();
  presence.connect({ organizationId: ORG, userId: "ativo", socketId: "s1", at: T0 });
  presence.connect({ organizationId: ORG, userId: "parado", socketId: "s2", at: T0 });
  presence.connect({ organizationId: ORG, userId: "saiu", socketId: "s3", at: T0 });
  presence.disconnect({ organizationId: ORG, userId: "saiu", socketId: "s3", at: T0 });

  const agora = T0 + 10 * MINUTE;
  presence.activity({ organizationId: ORG, userId: "ativo", at: agora });

  const entradas = presence.snapshot({ organizationId: ORG, at: agora });
  const porUsuario = new Map(entradas.map((entry) => [entry.userId, entry]));

  assert.deepEqual(
    [...porUsuario.keys()].sort(),
    ["ativo", "parado"],
  );
  assert.equal(porUsuario.get("ativo")?.state, "online");
  assert.equal(porUsuario.get("parado")?.state, "ausente");
});

test("snapshot conta as conexões abertas de cada pessoa", () => {
  const presence = registry();
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s1", at: T0 });
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s2", at: T0 });

  const [entrada] = presence.snapshot({ organizationId: ORG, at: T0 });

  assert.equal(entrada.connections, 2);
});

test("uma organização não enxerga a presença da outra", () => {
  // O mapa é por organização e o painel é multiempresa: vazar aqui exporia o
  // quadro de pessoal de um cliente para outro.
  const presence = registry();
  presence.connect({ organizationId: "org-a", userId: "u1", socketId: "s1", at: T0 });

  assert.deepEqual(presence.snapshot({ organizationId: "org-b", at: T0 }), []);
  assert.equal(presence.stateOf({ organizationId: "org-b", userId: "u1", at: T0 }), "offline");
});

test("o limite de ausência é configurável", () => {
  const presence = createPresenceRegistry({ idleAfterMs: MINUTE });
  presence.connect({ organizationId: ORG, userId: "u1", socketId: "s1", at: T0 });

  assert.equal(
    presence.stateOf({ organizationId: ORG, userId: "u1", at: T0 + 2 * MINUTE }),
    "ausente",
  );
});
