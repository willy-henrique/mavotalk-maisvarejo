/**
 * Organização da Caixa de entrada por fila e por dono do atendimento.
 *
 * Vive fora do componente por dois motivos. O primeiro é poder testar a regra
 * sem montar React. O segundo é que decidir "o que aparece e em que ordem" é
 * decisão de produto, e ela some quando fica diluída no meio de JSX.
 *
 * Aqui não há restrição de acesso: qualquer atendente continua enxergando
 * qualquer conversa. Isto é organização visual. Separar *acesso* exigiria filtro
 * no servidor — feito só na tela, seria vazamento com cara de funcionalidade.
 */

export type InboxTab = "abertas" | "minhas" | "resolvidos";

export type InboxStatusFilter =
  | "em_atendimento"
  | "aguardando"
  | "pendente_cliente"
  | null;

export type GroupableConversation = {
  id: string;
  status: string;
  queue: { id: string; name: string; colorHex?: string; menuOption?: number } | null;
  ticket?: { assignee?: { id: string } | null } | null;
};

/** Status que mantêm o chamado fora de Resolvidos. */
export const OPEN_STATUSES = ["aguardando", "em_atendimento", "pendente_cliente"];

/**
 * Identificador sintético do grupo de quem ainda não escolheu opção no menu.
 * Prefixado para nunca colidir com um id real de fila vindo do banco.
 */
export const NO_QUEUE_ID = "__sem_fila__";

export const NO_QUEUE_LABEL = "Sem fila";

/** Cinza dos demais elementos neutros da lista, para fila sem cor cadastrada. */
const DEFAULT_QUEUE_COLOR = "#475569";

/** Teto de `listConversations` no servidor. Ver lib/supabase-repo.ts. */
export const CONVERSATION_FETCH_LIMIT = 80;

export function isOpen(conversation: GroupableConversation): boolean {
  return OPEN_STATUSES.includes(conversation.status);
}

export function ownerIdOf(conversation: GroupableConversation): string | null {
  return conversation.ticket?.assignee?.id ?? null;
}

/**
 * Recorte da aba.
 *
 * `minhas` é a lista de trabalho do atendente: o que ele puxou e ainda não
 * fechou. O que ele resolveu sai dali e vai para Resolvidos junto com o dos
 * outros — senão a aba cresce para sempre e deixa de responder "o que falta
 * fazer agora".
 */
export function selectByTab<T extends GroupableConversation>(
  conversations: readonly T[],
  tab: InboxTab,
  currentUserId: string,
): T[] {
  if (tab === "resolvidos") {
    return conversations.filter((c) => !isOpen(c));
  }
  if (tab === "minhas") {
    return conversations.filter((c) => isOpen(c) && ownerIdOf(c) === currentUserId);
  }
  return conversations.filter((c) => isOpen(c));
}

/**
 * Filtros de status e de fila, aplicados em conjunto.
 *
 * São eixos independentes: "em atendimento" **e** "Delivery" responde
 * "o que o time de entrega está tocando agora", que é a pergunta real de quem
 * coordena. Se um filtro limpasse o outro, essa pergunta ficaria sem resposta.
 */
export function applyInboxFilters<T extends GroupableConversation>(
  conversations: readonly T[],
  filters: { statusFilter: InboxStatusFilter; queueId: string | null },
): T[] {
  return conversations.filter((conversation) => {
    if (filters.statusFilter && conversation.status !== filters.statusFilter) {
      return false;
    }
    if (!filters.queueId) return true;
    if (filters.queueId === NO_QUEUE_ID) return !conversation.queue;
    return conversation.queue?.id === filters.queueId;
  });
}

// ---------------------------------------------------------------------------
// Ordenação
// ---------------------------------------------------------------------------

/** Conversa com o bastante para saber quando o cliente falou por último. */
export type ActivityConversation = GroupableConversation & {
  updatedAt?: string;
  messages?: readonly { direction?: string; createdAt?: string }[];
};

function timeOf(value?: string): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Momento em que o cliente falou pela última vez.
 *
 * Só conta `inbound`. Resposta de atendente não é sinal de que alguém está
 * esperando: se contasse, responder uma conversa a jogaria para o topo e
 * empurraria para baixo justamente quem acabou de escrever e ainda não foi
 * atendido.
 *
 * Sem mensagem do cliente na carga, cai para `updatedAt`. A API devolve só as
 * 200 mensagens mais recentes da organização (ver lib/supabase-repo.ts), então
 * uma conversa sem mensagem carregada é, por construção, mais antiga que todas
 * as que têm — e o `updatedAt` a coloca no fim, que é onde ela pertence.
 */
export function lastInboundAt(conversation: ActivityConversation): number {
  let latest = 0;
  for (const message of conversation.messages ?? []) {
    if (message.direction !== "inbound") continue;
    const time = timeOf(message.createdAt);
    if (time > latest) latest = time;
  }
  return latest || timeOf(conversation.updatedAt);
}

/**
 * Quem mandou mensagem por último aparece primeiro.
 *
 * O servidor devolve em `updated_at desc`, e `updated_at` sobe com qualquer
 * mexida no registro — puxar o atendimento, trocar de fila, encerrar. A lista
 * então se reordenava por motivos invisíveis para quem olha, e a mensagem que
 * acabou de chegar aparecia no meio, sem nada que a distinguisse.
 *
 * Empate preserva a ordem recebida: `sort` é estável, então conversas sem
 * mensagem do cliente mantêm entre si o `updated_at desc` do servidor.
 */
export function sortByLastInbound<T extends ActivityConversation>(
  conversations: readonly T[],
): T[] {
  return [...conversations].sort((a, b) => lastInboundAt(b) - lastInboundAt(a));
}

export type InboxGroup<T extends GroupableConversation = GroupableConversation> = {
  queueId: string;
  name: string;
  colorHex: string;
  conversations: T[];
};

type GroupAccumulator<T extends GroupableConversation> = InboxGroup<T> & { menuOption: number };

/**
 * Agrupa por fila preservando a ordem do menu que o cliente final viu no
 * WhatsApp, com "Sem fila" fixo no topo.
 *
 * A posição do topo é intencional e não estética: ali estão as pessoas que
 * escreveram e ficaram paradas na triagem, sem ninguém dono. É o grupo que mais
 * precisa de olho e o que mais facilmente seria esquecido no fim da lista.
 *
 * Grupos vazios não são criados: uma fila cadastrada e sem movimento vira ruído
 * permanente na tela de quem trabalha.
 */
export function groupByQueue<T extends GroupableConversation>(
  conversations: readonly T[],
): InboxGroup<T>[] {
  const groups = new Map<string, GroupAccumulator<T>>();

  for (const conversation of conversations) {
    const queue = conversation.queue;
    const queueId = queue?.id ?? NO_QUEUE_ID;

    let group = groups.get(queueId);
    if (!group) {
      group = {
        queueId,
        name: queue?.name || NO_QUEUE_LABEL,
        colorHex: queue?.colorHex || DEFAULT_QUEUE_COLOR,
        // Sem fila fica antes de qualquer menuOption real, que começa em 0.
        menuOption: queue ? queue.menuOption ?? Number.MAX_SAFE_INTEGER : -1,
        conversations: [],
      };
      groups.set(queueId, group);
    }
    group.conversations.push(conversation);
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (a.menuOption !== b.menuOption) return a.menuOption - b.menuOption;
      // Filas sem menuOption cadastrado caem para ordem alfabética, que ao menos
      // é estável entre carregamentos.
      return a.name.localeCompare(b.name, "pt-BR");
    })
    .map(({ menuOption: _menuOption, ...group }) => group);
}

export type QueueChip = {
  queueId: string;
  name: string;
  colorHex: string;
  total: number;
};

/**
 * Chips de fila, na mesma ordem dos grupos.
 *
 * Derivam do mesmo agrupamento de propósito: chip e cabeçalho discordarem sobre
 * quantas conversas existem em uma fila destruiria a confiança nos dois.
 */
export function queueChipsFor(
  conversations: readonly GroupableConversation[],
): QueueChip[] {
  return groupByQueue(conversations).map((group) => ({
    queueId: group.queueId,
    name: group.name,
    colorHex: group.colorHex,
    total: group.conversations.length,
  }));
}

/**
 * A carga chegou no teto do servidor?
 *
 * Batendo no teto, todo número derivado pode ser menor que a realidade. Mostrar
 * "12" no Delivery quando podem ser trinta levaria a decisão errada sobre
 * remanejar equipe — e o operador não teria como desconfiar.
 */
export function isCountCapped(loadedTotal: number): boolean {
  return loadedTotal >= CONVERSATION_FETCH_LIMIT;
}

/**
 * Zero nunca leva "+".
 *
 * "0+" não quer dizer nada para quem lê: sugere que há algo escondido quando o
 * que existe é a ausência. O "+" só faz sentido admitindo que um número real
 * pode ser maior do que o mostrado.
 */
export function formatCount(value: number, capped: boolean): string {
  return capped && value > 0 ? `${value}+` : String(value);
}
