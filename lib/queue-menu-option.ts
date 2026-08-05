import type { QueryResultRow } from "pg";

/**
 * `queues` tem índice único em (organization_id, menu_option): duas filas não
 * podem dividir o mesmo número no menu do WhatsApp, senão a escolha do cliente
 * ficaria ambígua. Quando o administrador move uma fila para uma posição já
 * ocupada, a intenção é reordenar — então a fila que estava lá assume a posição
 * liberada, em vez de a gravação falhar com erro de chave duplicada.
 */
export type QueueMenuClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

export type MenuOptionSwap = {
  id: string;
  name: string;
  /** Posição que a fila deslocada passou a ocupar. */
  menuOption: number;
};

export const MIN_MENU_OPTION = 1;
export const MAX_MENU_OPTION = 99;

const UNIQUE_VIOLATION = "23505";

/** Reconhece a colisão de posição vinda do banco para virar 409 legível na API. */
export function isMenuOptionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code || "");
  const details = `${(error as { message?: unknown }).message || ""} ${(error as { constraint?: unknown }).constraint || ""} ${(error as { details?: unknown }).details || ""}`;
  return code === UNIQUE_VIOLATION && /menu_option/i.test(details);
}

export function menuOptionConflictMessage(swap: MenuOptionSwap | null): string {
  return swap
    ? `A opção ${swap.menuOption} já era usada pela fila "${swap.name}".`
    : "Esta opção do menu já está em uso por outra fila.";
}

/**
 * Libera a posição desejada para `queueId`, devolvendo a fila deslocada quando
 * houve troca. O chamador continua responsável por gravar a nova posição da
 * fila movida — assim a atualização dos demais campos segue em um único UPDATE.
 *
 * Deve rodar dentro de uma transação: a fila movida fica estacionada em uma
 * posição temporária (sempre abaixo do menor valor em uso, portanto livre) para
 * que o índice único não seja violado no meio da troca.
 */
export async function freeMenuOptionSlot(
  client: QueueMenuClient,
  organizationId: string,
  queueId: string,
  nextMenuOption: number,
): Promise<MenuOptionSwap | null> {
  const current = await client.query<{ id: string; name: string; menu_option: number }>(
    "SELECT id, name, menu_option FROM queues WHERE organization_id=$1 AND id=$2 FOR UPDATE",
    [organizationId, queueId],
  );
  if (!current.rowCount) return null;

  const currentMenuOption = Number(current.rows[0].menu_option);
  if (currentMenuOption === nextMenuOption) return null;

  const occupant = await client.query<{ id: string; name: string; menu_option: number }>(
    "SELECT id, name, menu_option FROM queues WHERE organization_id=$1 AND menu_option=$2 AND id<>$3 FOR UPDATE",
    [organizationId, nextMenuOption, queueId],
  );
  if (!occupant.rowCount) return null;

  // `LEAST(..., 0) - 1` garante um valor negativo e abaixo de tudo que existe:
  // a coluna tem DEFAULT 0, então estacionar apenas em `MIN - 1` poderia cair em
  // cima de uma linha legada que ficou no zero.
  await client.query(
    "UPDATE queues SET menu_option=(SELECT LEAST(COALESCE(MIN(menu_option),0),0)-1 FROM queues WHERE organization_id=$1), updated_at=now() WHERE organization_id=$1 AND id=$2",
    [organizationId, queueId],
  );
  await client.query(
    "UPDATE queues SET menu_option=$3, updated_at=now() WHERE organization_id=$1 AND id=$2",
    [organizationId, occupant.rows[0].id, currentMenuOption],
  );

  return {
    id: String(occupant.rows[0].id),
    name: String(occupant.rows[0].name),
    menuOption: currentMenuOption,
  };
}
