/**
 * Constantes e formatação da transferência de chamado, do lado da tela.
 *
 * O limite do motivo é repetido aqui de propósito, para o `maxLength` do campo
 * impedir o texto longo antes do envio — falhar só no servidor faria o técnico
 * perder a explicação que acabou de escrever. A recusa no servidor continua
 * existindo: `lib/ticket-transfer.ts` é quem manda.
 */

export const MAX_TRANSFER_NOTE_LENGTH = 500;

export type TransferBanner = {
  fromName: string;
  note: string;
  at: string;
};

type TicketLike = {
  transferredAt?: string | null;
  transferNote?: string | null;
  transferredFrom?: { id: string; name: string | null } | null;
} | null | undefined;

/**
 * A faixa de "chegou transferido" só aparece para quem precisa dela.
 *
 * Quem transferiu já sabe o motivo — foi ele quem escreveu. Mostrar a faixa para
 * essa pessoa seria eco. E um chamado devolvido para a fila não tem dono: ali a
 * faixa vale para qualquer um que abrir, porque é o contexto de por que o
 * chamado voltou.
 */
export function transferBannerFor(
  ticket: TicketLike,
  viewerId: string,
): TransferBanner | null {
  if (!ticket?.transferredAt || !ticket.transferNote) return null;
  if (ticket.transferredFrom?.id === viewerId) return null;
  return {
    fromName: ticket.transferredFrom?.name || 'outro técnico',
    note: ticket.transferNote,
    at: ticket.transferredAt,
  };
}
