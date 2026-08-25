/**
 * Presença da equipe: ordenação, atualização por evento e "visto por último".
 *
 * Vive fora do componente pelo mesmo motivo de `inboxGrouping`: decidir o que a
 * tela mostra e em que ordem é decisão de produto, e ela some quando fica
 * diluída no meio de JSX. Aqui também dá para testar sem montar React.
 */

export type PresenceState = 'online' | 'ausente' | 'offline';

export type TeamPresenceMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  state: PresenceState;
  connections: number;
  lastSeenAt: string | null;
  openConversations: number;
};

/** Entrada do evento `presence.updated`, emitido pelo socket. */
export type PresenceLiveEntry = {
  userId: string;
  state: PresenceState;
  lastActivityAt: number;
  connections: number;
};

const STATE_ORDER: Record<PresenceState, number> = {
  online: 0,
  ausente: 1,
  offline: 2,
};

/**
 * Online primeiro, e dentro de cada estado o mais carregado antes.
 *
 * A segunda chave não é detalhe: quem coordena abre esta lista procurando
 * sobrecarga. Ordenar só por nome esconderia o atendente com sete chamados no
 * meio da lista, que é exatamente a informação que motiva agir.
 */
export function sortByPresence<T extends TeamPresenceMember>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    if (a.openConversations !== b.openConversations) {
      return b.openConversations - a.openConversations;
    }
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

/**
 * Aplica o evento do socket sobre a equipe já carregada.
 *
 * O evento carrega a lista completa de quem está conectado naquela organização,
 * e não um delta. Por isso quem não aparece nele volta para offline: tratar a
 * ausência como "sem novidade" deixaria gente eternamente online depois de
 * fechar o navegador.
 *
 * A equipe carregada do banco continua sendo quem decide **quem existe**. Um id
 * que chega no evento sem estar na lista é ignorado — usuário desativado entre
 * a carga e o evento não reaparece na tela.
 */
export function applyPresenceUpdate<T extends TeamPresenceMember>(
  members: readonly T[],
  live: readonly PresenceLiveEntry[],
): T[] {
  const byUser = new Map(live.map((entry) => [entry.userId, entry]));
  return members.map((member) => {
    const entry = byUser.get(member.id);
    if (!entry) {
      if (member.state === 'offline') return member;
      return { ...member, state: 'offline' as const, connections: 0 };
    }
    return {
      ...member,
      state: entry.state,
      connections: entry.connections,
      lastSeenAt: new Date(entry.lastActivityAt).toISOString(),
    };
  });
}

export function presenceTotals(members: readonly TeamPresenceMember[]) {
  let online = 0;
  let ausente = 0;
  for (const member of members) {
    if (member.state === 'online') online++;
    else if (member.state === 'ausente') ausente++;
  }
  return {
    online,
    ausente,
    offline: members.length - online - ausente,
    equipe: members.length,
  };
}

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/**
 * "Visto por último" em texto curto.
 *
 * Instante no futuro vira "agora" em vez de tempo negativo: o relógio do
 * servidor e o do navegador não são o mesmo, e uma diferença de segundos não
 * deveria produzir "há -1 min" na tela de ninguém.
 */
export function formatLastSeen(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return 'nunca entrou';
  const seen = new Date(value).getTime();
  if (Number.isNaN(seen)) return 'nunca entrou';

  const elapsed = now - seen;
  if (elapsed < MINUTO) return 'agora';
  if (elapsed < HORA) {
    const minutos = Math.floor(elapsed / MINUTO);
    return `há ${minutos} min`;
  }
  if (elapsed < DIA) {
    const horas = Math.floor(elapsed / HORA);
    return `há ${horas} h`;
  }
  const dias = Math.floor(elapsed / DIA);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}
