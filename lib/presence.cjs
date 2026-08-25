/**
 * Quem está no painel agora.
 *
 * A fonte da verdade são as conexões do socket, que já chegam autenticadas com
 * `userId` e `organizationId` (ver server.cjs). Nada aqui consulta banco: o
 * estado vive em memória e some junto com o processo — de propósito. "Está
 * conectado agora" é uma pergunta sobre o processo vivo, não sobre um registro.
 * A memória do que ficou para trás é `users.last_seen_at`, gravado no disconnect.
 *
 * Mora em `.cjs` porque precisa ser o mesmo objeto para o `server.cjs`, que
 * roda o socket, e para as rotas do Next, que respondem a API. É o padrão que
 * `lib/config/cors.cjs` já estabeleceu.
 *
 * Limite conhecido: o mapa é de uma instância. O plano gratuito do Render roda
 * uma só, então isto responde certo. Com duas instâncias, cada uma enxergaria
 * metade da equipe — aí a presença precisa migrar para o Key Value que o
 * `render.yaml` já declara.
 */

/** Conectado, mas sem interagir por mais que isto: ausente, não online. */
const IDLE_AFTER_MS = 5 * 60 * 1000;

function resolveState(entry, at, idleAfterMs) {
  if (!entry || entry.sockets.size === 0) return "offline";
  return at - entry.lastActivityAt > idleAfterMs ? "ausente" : "online";
}

function createPresenceRegistry(options) {
  const idleAfterMs = Number(options && options.idleAfterMs) || IDLE_AFTER_MS;
  /** organizationId -> Map(userId -> { sockets:Set<string>, lastActivityAt:number }) */
  const organizations = new Map();

  function usersOf(organizationId) {
    let users = organizations.get(organizationId);
    if (!users) {
      users = new Map();
      organizations.set(organizationId, users);
    }
    return users;
  }

  function entryOf(organizationId, userId) {
    const users = organizations.get(organizationId);
    return users ? users.get(userId) : undefined;
  }

  return {
    connect({ organizationId, userId, socketId, at }) {
      if (!organizationId || !userId || !socketId) return;
      const users = usersOf(organizationId);
      const entry = users.get(userId);
      if (entry) {
        entry.sockets.add(socketId);
        entry.lastActivityAt = at;
        return;
      }
      users.set(userId, { sockets: new Set([socketId]), lastActivityAt: at });
    },

    /**
     * Ping de interação. Ignorado para quem não está conectado: um ping atrasado,
     * chegando depois do disconnect, não pode ressuscitar quem fechou o painel.
     */
    activity({ organizationId, userId, at }) {
      const entry = entryOf(organizationId, userId);
      if (!entry || entry.sockets.size === 0) return;
      entry.lastActivityAt = at;
    },

    /**
     * Devolve se a pessoa continua conectada por outra aba, e o instante que o
     * chamador deve persistir em `users.last_seen_at` quando não continua.
     */
    disconnect({ organizationId, userId, socketId, at }) {
      const entry = entryOf(organizationId, userId);
      if (!entry) return { stillConnected: false, lastActivityAt: at };

      entry.sockets.delete(socketId);
      if (entry.sockets.size > 0) {
        return { stillConnected: true, lastActivityAt: entry.lastActivityAt };
      }

      const users = organizations.get(organizationId);
      if (users) {
        users.delete(userId);
        if (users.size === 0) organizations.delete(organizationId);
      }
      return { stillConnected: false, lastActivityAt: at };
    },

    stateOf({ organizationId, userId, at }) {
      return resolveState(entryOf(organizationId, userId), at, idleAfterMs);
    },

    snapshot({ organizationId, at }) {
      const users = organizations.get(organizationId);
      if (!users) return [];
      const entries = [];
      for (const [userId, entry] of users) {
        entries.push({
          userId,
          state: resolveState(entry, at, idleAfterMs),
          lastActivityAt: entry.lastActivityAt,
          connections: entry.sockets.size,
        });
      }
      return entries;
    },

    clear() {
      organizations.clear();
    },
  };
}

/**
 * Registro único do processo.
 *
 * Mesmo motivo do `global.__io` em lib/realtime.ts: o socket é montado pelo
 * server.cjs e as rotas do Next rodam no mesmo processo, mas em módulos que o
 * bundler pode instanciar mais de uma vez.
 */
function getPresenceRegistry() {
  if (!global.__presence) {
    global.__presence = createPresenceRegistry();
  }
  return global.__presence;
}

module.exports = {
  IDLE_AFTER_MS,
  createPresenceRegistry,
  getPresenceRegistry,
};
