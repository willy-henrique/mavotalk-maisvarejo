import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiGet, getAccessToken, getSocketUrl } from '../services/api';
import {
  applyPresenceUpdate,
  formatLastSeen,
  presenceTotals,
  sortByPresence,
  type PresenceLiveEntry,
  type PresenceState,
  type TeamPresenceMember,
} from '../services/presence';

/**
 * Quem da equipe está no painel agora.
 *
 * Duas fontes, de propósito. A carga por HTTP decide quem existe e quantos
 * atendimentos cada um tem em aberto — informação que só o banco tem. O socket
 * corrige o estado enquanto a tela fica aberta, para o quadro não envelhecer na
 * frente de quem está usando ele para decidir a quem passar um chamado.
 *
 * A recarga periódica existe porque o evento de presença não carrega a carga de
 * atendimentos: sem ela, os números ao lado do nome congelariam.
 */

const RECARGA_MS = 60_000;

const ESTILO_ESTADO: Record<PresenceState, { dot: string; texto: string; rotulo: string }> = {
  online: { dot: 'bg-emerald-500', texto: 'text-emerald-600 dark:text-emerald-400', rotulo: 'Online' },
  ausente: { dot: 'bg-amber-500', texto: 'text-amber-600 dark:text-amber-400', rotulo: 'Ausente' },
  offline: { dot: 'bg-slate-400', texto: 'text-slate-500 dark:text-slate-400', rotulo: 'Offline' },
};

const PAPEL: Record<string, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  atendente: 'Atendente',
};

type PresenceResponse = {
  members: TeamPresenceMember[];
  generatedAt: string;
};

const TeamPresence: React.FC = () => {
  const [members, setMembers] = useState<TeamPresenceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiGet<PresenceResponse>('/api/presence');
      setMembers(response.members || []);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Presença indisponível.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), RECARGA_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const socket = io(getSocketUrl(), {
      path: '/socket.io',
      withCredentials: true,
      auth: { token: getAccessToken() || undefined },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;

    socket.on('presence.updated', (payload: { members?: PresenceLiveEntry[] }) => {
      setMembers((atual) => applyPresenceUpdate(atual, payload?.members || []));
    });

    // Reconectar depois de uma queda pode ter perdido eventos; recarregar é mais
    // barato que tentar reconstruir o que passou enquanto a conexão esteve fora.
    socket.on('connect', () => { void load(); });

    return () => {
      socketRef.current = null;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [load]);

  const ordenados = sortByPresence(members);
  const totais = presenceTotals(members);
  const agora = Date.now();

  return (
    <section className="mavo-card mt-6 p-5 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-black text-slate-900 dark:text-white">Equipe agora</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Quem está no painel neste momento e quanto cada um está segurando.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['online', 'ausente', 'offline'] as const).map((estado) => (
            <span
              key={estado}
              className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              <span className={`h-2 w-2 rounded-full ${ESTILO_ESTADO[estado].dot}`} aria-hidden="true" />
              {totais[estado]} {ESTILO_ESTADO[estado].rotulo.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </p>
      )}

      {loading && members.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-slate-500">Carregando a equipe…</div>
      ) : ordenados.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700">
          Nenhum usuário ativo cadastrado na equipe.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700/80">
          {ordenados.map((member) => {
            const estilo = ESTILO_ESTADO[member.state];
            return (
              <li key={member.id} className="flex items-center gap-3 py-3">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${estilo.dot}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-slate-900 dark:text-white">{member.name || member.email}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {PAPEL[member.role] || member.role}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-xs font-bold ${estilo.texto}`}>
                    {estilo.rotulo}
                    <span className="sr-only"> — {member.name}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {member.state === 'online' ? 'ativo agora' : formatLastSeen(member.lastSeenAt, agora)}
                  </p>
                </div>
                <div className="ml-2 shrink-0 text-center">
                  <p
                    className="text-lg font-black leading-none text-slate-900 dark:text-white"
                    title={`${member.openConversations} atendimento(s) em aberto`}
                  >
                    {member.openConversations}
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Abertos</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default TeamPresence;
