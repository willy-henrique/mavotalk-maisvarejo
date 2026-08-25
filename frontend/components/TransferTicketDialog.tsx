import React, { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../services/api';
import {
  formatLastSeen,
  sortByPresence,
  type TeamPresenceMember,
} from '../services/presence';
import { MAX_TRANSFER_NOTE_LENGTH } from '../services/transfer';
import { Dialog } from './ui/Dialog';

/**
 * Para quem passar o chamado.
 *
 * A lista mostra presença e carga porque transferir para quem foi embora é o
 * principal jeito de um chamado morrer parado. "Online com sete abertos" e
 * "online com zero" pedem decisões opostas, e sem esses dois números a escolha
 * seria pelo nome que a pessoa lembra.
 *
 * A fila é a saída para "não sei quem, mas não é comigo": solta o chamado de
 * volta para Aguardando, sem dono, para quem estiver livre puxar.
 */

const ESTILO: Record<TeamPresenceMember['state'], { dot: string; rotulo: string }> = {
  online: { dot: 'bg-emerald-500', rotulo: 'Online' },
  ausente: { dot: 'bg-amber-500', rotulo: 'Ausente' },
  offline: { dot: 'bg-slate-400', rotulo: 'Offline' },
};

const PAPEL: Record<string, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  atendente: 'Atendente',
};

type Destino = { kind: 'user'; userId: string } | { kind: 'queue' } | null;

type Props = {
  conversationId: string;
  currentUserId: string;
  queueName: string | null;
  onClose: () => void;
  onTransferred: (destino: 'user' | 'queue') => void;
};

const TransferTicketDialog: React.FC<Props> = ({
  conversationId,
  currentUserId,
  queueName,
  onClose,
  onTransferred,
}) => {
  const [team, setTeam] = useState<TeamPresenceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [destino, setDestino] = useState<Destino>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiGet<{ members: TeamPresenceMember[] }>('/api/presence');
      setTeam(response.members || []);
    } catch {
      // A presença é enfeite útil, não requisito: sem ela ainda dá para
      // transferir. O erro só aparece se o envio falhar de verdade.
      setTeam([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!destino) {
      setError('Escolha um técnico ou a fila.');
      return;
    }
    if (!note.trim()) {
      setError('Escreva o motivo da transferência.');
      return;
    }
    setError('');
    setSending(true);
    try {
      await apiPost(`/api/conversations/${conversationId}/transfer`, {
        ...(destino.kind === 'user' ? { toUserId: destino.userId } : { toQueue: true }),
        note: note.trim(),
      });
      onTransferred(destino.kind);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível transferir o chamado.');
    } finally {
      setSending(false);
    }
  };

  // Você não aparece na própria lista: transferir para si mesmo só geraria
  // histórico e notificação sem mover nada.
  const candidatos = sortByPresence(team.filter((member) => member.id !== currentUserId));
  const agora = Date.now();

  return (
    <Dialog
      title="Transferir chamado"
      description="Passe o atendimento para outro técnico ou devolva para a fila."
      onClose={() => { if (!sending) onClose(); }}
    >
      <form onSubmit={enviar} className="space-y-4 p-6">
        <div>
          <p className="mb-2 text-xs font-bold uppercase text-slate-500">Para quem</p>

          <button
            type="button"
            onClick={() => setDestino({ kind: 'queue' })}
            className={`mb-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
              destino?.kind === 'queue'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" aria-hidden="true">
              ↩
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-slate-900 dark:text-white">
                Devolver para a fila{queueName ? ` — ${queueName}` : ''}
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Volta para Aguardando, sem dono, para quem estiver livre puxar.
              </span>
            </span>
          </button>

          {loading ? (
            <p className="py-4 text-center text-sm text-slate-500">Carregando a equipe…</p>
          ) : candidatos.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
              Não há outro técnico ativo na equipe.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {candidatos.map((member) => {
                const estilo = ESTILO[member.state];
                const escolhido = destino?.kind === 'user' && destino.userId === member.id;
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => setDestino({ kind: 'user', userId: member.id })}
                      aria-pressed={escolhido}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                        escolhido
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${estilo.dot}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold text-slate-900 dark:text-white">
                          {member.name || member.email}
                        </span>
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                          {PAPEL[member.role] || member.role} · {estilo.rotulo}
                          {member.state === 'online' ? '' : ` · ${formatLastSeen(member.lastSeenAt, agora)}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-center">
                        <span className="block text-base font-black leading-none text-slate-900 dark:text-white">
                          {member.openConversations}
                        </span>
                        <span className="block text-[10px] font-bold uppercase text-slate-400">Abertos</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <label htmlFor="transfer-note" className="mb-1 block text-xs font-bold uppercase text-slate-500">
            Motivo *
          </label>
          <textarea
            id="transfer-note"
            data-autofocus
            rows={3}
            value={note}
            maxLength={MAX_TRANSFER_NOTE_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex.: cliente quer segunda via de nota, é com o Financeiro."
            className="mavo-field"
          />
          <p className="mt-1 text-xs text-slate-500">
            Quem receber vê este texto no topo da conversa. Sem ele, a pessoa precisa reler tudo
            para descobrir o que já foi tentado.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={sending} className="mavo-button-secondary">
            Cancelar
          </button>
          <button type="submit" disabled={sending || !destino} className="mavo-button-primary">
            {sending ? 'Transferindo…' : 'Transferir'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default TransferTicketDialog;
