/**
 * Leitura da presença ao vivo pelo lado do Next.
 *
 * A implementação está em `lib/presence.cjs`, carregada pelo `server.cjs` junto
 * com o socket. Aqui só se lê o registro que ele publicou em `global.__presence`
 * — mesmo arranjo que `lib/realtime.ts` usa para o `global.__io`: quem constrói
 * é o servidor, quem consome são as rotas, e o global é o ponto de encontro.
 *
 * Registro ausente significa que nenhum socket subiu ainda neste processo. A
 * resposta correta nesse caso é "ninguém conectado", não um erro: é exatamente
 * o estado do serviço recém-acordado da hibernação.
 */

export type PresenceState = "online" | "ausente" | "offline";

export type PresenceEntry = {
  userId: string;
  state: PresenceState;
  lastActivityAt: number;
  connections: number;
};

type PresenceRegistry = {
  snapshot(input: { organizationId: string; at: number }): PresenceEntry[];
  stateOf(input: { organizationId: string; userId: string; at: number }): PresenceState;
};

declare global {
  // eslint-disable-next-line no-var
  var __presence: PresenceRegistry | undefined;
}

export function presenceSnapshot(
  organizationId: string,
  at: number = Date.now(),
): PresenceEntry[] {
  if (!organizationId) return [];
  return global.__presence?.snapshot({ organizationId, at }) ?? [];
}

export function presenceStateOf(
  organizationId: string,
  userId: string,
  at: number = Date.now(),
): PresenceState {
  if (!organizationId || !userId) return "offline";
  return global.__presence?.stateOf({ organizationId, userId, at }) ?? "offline";
}
