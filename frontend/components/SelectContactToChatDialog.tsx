import React, { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { apiFetch, apiPost } from '../services/api';
import { Dialog } from './ui/Dialog';
import { Icons } from '../constants';
import StartConversationDialog from './StartConversationDialog';

type ApiContact = {
  id: string;
  name: string;
  phoneNumber: string;
  avatarUrl: string | null;
  lastInteraction: string | null;
  status: 'ativo' | 'encerrado';
  blocked: boolean;
  botDisabled: boolean;
  internalNote: string | null;
  lastConversationId: string | null;
};

interface SelectContactToChatDialogProps {
  onClose: () => void;
  onSelectConversation: (conversationId: string) => void;
}

export const SelectContactToChatDialog: React.FC<SelectContactToChatDialogProps> = ({
  onClose,
  onSelectConversation,
}) => {
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [startingId, setStartingId] = useState<string | null>(null);
  const [showManualStart, setShowManualStart] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const requestRef = useRef(0);

  const fetchContacts = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50' });
      if (deferredSearch.trim()) params.set('q', deferredSearch.trim());
      const res = await apiFetch(`/api/contacts?${params.toString()}`, { method: 'GET' });
      const data = (await res.json()) as { items?: ApiContact[]; error?: string };
      if (request !== requestRef.current) return;
      if (!res.ok) throw new Error(data.error || 'Não foi possível carregar os contatos.');
      setContacts(Array.isArray(data.items) ? data.items : []);
    } catch (reason) {
      if (request !== requestRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os contatos.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [deferredSearch]);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  const handleStartChat = async (contact: ApiContact) => {
    setStartingId(contact.id);
    setError('');
    try {
      const result = await apiPost<{ conversationId: string }>(`/api/contacts/${contact.id}/start-conversation`, {});
      if (result?.conversationId) {
        onSelectConversation(result.conversationId);
        onClose();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o chamado com este contato.');
    } finally {
      setStartingId(null);
    }
  };

  if (showManualStart) {
    return (
      <StartConversationDialog
        onClose={() => setShowManualStart(false)}
        onStarted={(conversationId) => {
          onSelectConversation(conversationId);
          onClose();
        }}
      />
    );
  }

  return (
    <Dialog
      title="Iniciar atendimento"
      description="Selecione um contato salvo para abrir a conversa ou inicie um número novo."
      onClose={onClose}
    >
      <div className="flex flex-col p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 pl-9 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
            />
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.447 9.785l2.634 2.634a.75.75 0 1 0 1.06-1.06l-2.633-2.634A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
            </svg>
          </div>
          <button
            type="button"
            onClick={() => setShowManualStart(true)}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300 transition"
            title="Digitar número que não está na agenda"
          >
            <span>+ Número novo</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        )}

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-500">Carregando contatos...</div>
          ) : contacts.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Nenhum contato encontrado</p>
              <p className="text-xs text-slate-500">Deseja iniciar conversa informando o número manualmente?</p>
              <button
                type="button"
                onClick={() => setShowManualStart(true)}
                className="mt-2 text-xs font-bold text-blue-600 dark:text-blue-400 underline"
              >
                Informar número de WhatsApp
              </button>
            </div>
          ) : (
            contacts.map((contact) => {
              const isStarting = startingId === contact.id;
              const initials = (contact.name || 'Contato')
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase())
                .join('') || 'C';

              return (
                <div
                  key={contact.id}
                  className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-xs font-black text-blue-700 dark:bg-blue-950/60 dark:text-blue-200">
                      {initials}
                      {contact.avatarUrl && (
                        <img
                          src={contact.avatarUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {contact.name || 'Sem nome'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                        {contact.phoneNumber}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isStarting}
                    onClick={() => void handleStartChat(contact)}
                    className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {isStarting ? 'Abrindo...' : 'Chamar'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className="mavo-button-secondary text-xs">
            Fechar
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default SelectContactToChatDialog;
