/**
 * Regras da transferência de chamado.
 *
 * Fora da rota porque decidir "esta transferência é válida" é regra de negócio
 * e precisa ser afirmada em teste sem subir Next nem banco. A rota fica sendo
 * só sessão, permissão, persistência e eventos.
 */

/** Cabe uma explicação real, não um romance que ninguém lê no meio de um turno. */
export const MAX_TRANSFER_NOTE_LENGTH = 500;

export type TransferCandidate = {
  id: string;
  isActive: boolean;
};

export type TransferRequest = {
  toUserId?: string;
  /** Solta o chamado de volta para a fila, sem dono. */
  toQueue?: boolean;
  note?: string;
};

export type TransferTarget = { kind: "user"; userId: string } | { kind: "queue" };

export type TransferParseResult =
  | { ok: true; target: TransferTarget; note: string }
  | { ok: false; error: string };

function fail(error: string): TransferParseResult {
  return { ok: false, error };
}

export function parseTransferRequest(
  request: TransferRequest,
  context: { currentUserId: string; team: readonly TransferCandidate[] },
): TransferParseResult {
  const toQueue = request.toQueue === true;
  const toUserId = typeof request.toUserId === "string" ? request.toUserId.trim() : "";

  if (request.toUserId !== undefined && typeof request.toUserId !== "string") {
    return fail("Destinatário inválido.");
  }
  // Os dois destinos ao mesmo tempo, ou nenhum: em ambos os casos o servidor
  // teria que adivinhar a intenção, e adivinhar aqui move um chamado real.
  if (toQueue === Boolean(toUserId)) {
    return fail("Escolha um destino: um técnico ou a fila.");
  }

  const note = typeof request.note === "string" ? request.note.trim() : "";
  if (!note) {
    return fail("Escreva o motivo da transferência.");
  }
  if (note.length > MAX_TRANSFER_NOTE_LENGTH) {
    return fail(`O motivo deve ter no máximo ${MAX_TRANSFER_NOTE_LENGTH} caracteres.`);
  }

  if (toQueue) {
    return { ok: true, target: { kind: "queue" }, note };
  }

  if (toUserId === context.currentUserId) {
    return fail("Você não pode transferir o chamado para você mesmo.");
  }

  const candidate = context.team.find((member) => member.id === toUserId);
  if (!candidate) {
    return fail("Técnico não encontrado na sua equipe.");
  }
  if (!candidate.isActive) {
    return fail("Esse técnico não está ativo.");
  }

  return { ok: true, target: { kind: "user", userId: toUserId }, note };
}
