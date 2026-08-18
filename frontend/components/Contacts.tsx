import React, { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, apiPatch, apiPost } from '../services/api';
import { Dialog } from './ui/Dialog';
import StartConversationDialog from './StartConversationDialog';
import { EmptyState, ErrorState } from './ui/PageState';
import { Pagination } from './ui/Pagination';
import { StatusBadge } from './ui/StatusBadge';
import { AvatarPreviewDialog } from './ui/AvatarPreviewDialog';

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

const ContactStatusBadge: React.FC<{ contact: ApiContact; className?: string }> = ({ contact, className = '' }) => {
  // Contato vindo da agenda do WhatsApp nunca conversou. Exibi-lo como "encerrado"
  // sugeriria um atendimento que não existiu.
  const neverTalked = !contact.blocked && !contact.lastInteraction;
  return (
    <StatusBadge
      tone={contact.blocked ? 'error' : contact.status === 'ativo' ? 'success' : 'neutral'}
      className={`uppercase tracking-wide ${className}`}
    >
      {contact.blocked ? 'Bloqueado' : neverTalked ? 'Sem conversa' : contact.status}
    </StatusBadge>
  );
};

const ContactAvatar: React.FC<{
  contact: ApiContact;
  onPreview: (contact: ApiContact) => void;
}> = ({ contact, onPreview }) => {
  const initials = (contact.name || 'Contato')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'C';

  const avatar = (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-xs font-black text-blue-700 dark:bg-blue-950/60 dark:text-blue-200">
      {initials}
      {contact.avatarUrl && (
        <img
          src={contact.avatarUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      )}
    </span>
  );

  if (!contact.avatarUrl) return avatar;
  return (
    <button
      type="button"
      onClick={() => onPreview(contact)}
      aria-label={`Ampliar foto de ${contact.name || 'Contato'}`}
      title="Ampliar foto"
      className="shrink-0 rounded-full transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
    >
      {avatar}
    </button>
  );
};

const Contacts: React.FC = () => {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [noteModal, setNoteModal] = useState<ApiContact | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startChatOpen, setStartChatOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [botToggleId, setBotToggleId] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<ApiContact | null>(null);
  const deferredSearch = useDeferredValue(search);
  const requestRef = useRef(0);
  const pageSize = 25;

  const fetchContacts = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (deferredSearch.trim()) params.set('q', deferredSearch.trim());
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiFetch(`/api/contacts?${params.toString()}`, { method: 'GET' });
      const data = (await res.json()) as { items?: ApiContact[]; total?: number; error?: string };
      if (request !== requestRef.current) return;
      if (!res.ok) throw new Error(data.error || 'Não foi possível carregar os contatos.');
      setContacts(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (reason) {
      if (request !== requestRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os contatos.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [deferredSearch, page, statusFilter]);

  useEffect(() => { void fetchContacts(); }, [fetchContacts]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const openConversation = (contact: ApiContact) => {
    navigate(contact.lastConversationId ? `/inbox?conversation=${contact.lastConversationId}` : '/inbox');
  };

  const startConversation = async (contact: ApiContact) => {
    setStartingId(contact.id);
    setError('');
    try {
      const result = await apiPost<{ conversationId: string }>(`/api/contacts/${contact.id}/start-conversation`, {});
      navigate(`/inbox?conversation=${result.conversationId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar a conversa.');
    } finally {
      setStartingId(null);
    }
  };

  const syncWhatsappContacts = async () => {
    setSyncing(true);
    setNotice('');
    setError('');
    try {
      const result = await apiPost<{
        synced: number;
        added: number;
        pending: boolean;
        avatars?: { requested: number; found: number; saved: number; pending: number };
      }>(
        '/api/contacts/sync-whatsapp',
      );
      await fetchContacts();
      // O aparelho pode continuar enviando dados depois da resposta; prometer um
      // total definitivo faria o operador achar que faltou contato.
      const avatarNotice = result.avatars?.pending
        ? ' As fotos de perfil continuam sendo carregadas em segundo plano.'
        : result.avatars?.requested
          ? ` Fotos de perfil disponíveis verificadas: ${result.avatars.found}.`
          : '';
      setNotice(
        result.pending
          ? `Sincronização solicitada. Os contatos aparecem à medida que o celular envia — atualize a lista em instantes.${avatarNotice}`
          : `Agenda sincronizada: ${result.synced} número${result.synced === 1 ? '' : 's'} do celular${result.added ? `, ${result.added} novo${result.added === 1 ? '' : 's'}` : ''}.${avatarNotice}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível sincronizar os contatos.');
    } finally {
      setSyncing(false);
    }
  };

  const toggleBlock = async (contact: ApiContact) => {
    setBlockingId(contact.id);
    setNotice('');
    setError('');
    try {
      await apiPatch(`/api/contacts/${contact.id}`, { blocked: !contact.blocked });
      await fetchContacts();
      setNotice(contact.blocked ? 'Contato desbloqueado para atendimento.' : 'Contato bloqueado para novas mensagens.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o bloqueio.');
    } finally {
      setBlockingId(null);
    }
  };

  const toggleBot = async (contact: ApiContact) => {
    setBotToggleId(contact.id);
    setNotice('');
    setError('');
    try {
      await apiPatch(`/api/contacts/${contact.id}`, {
        botDisabled: !contact.botDisabled,
      });
      await fetchContacts();
      setNotice(
        contact.botDisabled
          ? `Bot ativado para ${contact.name || 'o contato'}.`
          : `Bot desativado para ${contact.name || 'o contato'}. As mensagens continuam chegando ao Inbox.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o bot deste contato.');
    } finally {
      setBotToggleId(null);
    }
  };

  const saveNote = async () => {
    if (!noteModal) return;
    setSavingNote(true);
    try {
      await apiPatch(`/api/contacts/${noteModal.id}`, { internalNote: noteValue.trim() || null });
      setNoteModal(null);
      await fetchContacts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a nota.');
    } finally {
      setSavingNote(false);
    }
  };

  const contactActions = (contact: ApiContact, compact = false) => (
    <div className={`flex flex-wrap justify-end gap-2 ${compact ? 'justify-start' : ''}`}>
      <button
        type="button"
        onClick={() => void startConversation(contact)}
        disabled={startingId === contact.id || contact.blocked}
        className="mavo-button-primary min-h-0 rounded-lg px-3 py-2 text-xs"
      >
        {startingId === contact.id ? 'Abrindo...' : 'Conversar'}
      </button>
      <button type="button" onClick={() => openConversation(contact)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
        Histórico
      </button>
      <button
        type="button"
        onClick={() => { setNoteModal(contact); setNoteValue(contact.internalNote || ''); }}
        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        Nota
      </button>
      <button
        type="button"
        disabled={botToggleId === contact.id}
        onClick={() => void toggleBot(contact)}
        aria-pressed={contact.botDisabled}
        title={contact.botDisabled ? 'Permitir respostas automáticas para este contato' : 'Impedir respostas automáticas para este contato'}
        className={`rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${contact.botDisabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-200'}`}
      >
        {botToggleId === contact.id ? 'Atualizando…' : contact.botDisabled ? 'Ativar bot' : 'Desativar bot'}
      </button>
      <button
        type="button"
        disabled={blockingId === contact.id}
        onClick={() => void toggleBlock(contact)}
        className={`rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${contact.blocked ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-200'}`}
      >
        {blockingId === contact.id ? 'Atualizando…' : contact.blocked ? 'Desbloquear' : 'Bloquear'}
      </button>
    </div>
  );

  return (
    <main className="mavo-page"><div className="mavo-page-content">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        {/* A lista deixou de ser só de quem conversou: a agenda do WhatsApp conectado
            também entra, então o rótulo antigo passou a ser falso. */}
        <p className="text-sm text-slate-500 dark:text-slate-400">{total} contato{total === 1 ? '' : 's'} no Mavo, incluindo a agenda do WhatsApp conectado.</p>
        <div className="flex flex-wrap items-center gap-2">
          {/* A lista só mostra quem já escreveu; é aqui que a operação percebe a falta
              de um número novo e precisa do caminho para iniciar o contato. */}
          <button type="button" onClick={() => setStartChatOpen(true)} className="mavo-button-primary">+ Nova conversa</button>
          <button type="button" onClick={() => void syncWhatsappContacts()} disabled={syncing} className="mavo-button-secondary">
            {syncing ? 'Sincronizando...' : 'Sincronizar contatos do celular'}
          </button>
          <button type="button" onClick={() => void fetchContacts()} disabled={loading} className="mavo-button-secondary">{loading ? 'Atualizando...' : 'Atualizar lista'}</button>
        </div>
      </div>
      {startChatOpen && (
        <StartConversationDialog
          onClose={() => setStartChatOpen(false)}
          onStarted={(conversationId) => navigate(`/inbox?conversation=${conversationId}`)}
        />
      )}
      {error && <ErrorState className="mb-5" description={error} action={<button type="button" onClick={() => void fetchContacts()} disabled={loading} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}
      {notice && <div role="status" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</div>}
      <div className="mb-6 flex max-w-2xl flex-wrap gap-3"><label className="min-w-[min(100%,20rem)] flex-1"><span className="sr-only">Buscar contatos</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" className="mavo-field" /></label><label className="min-w-44"><span className="sr-only">Estado do contato</span><select aria-label="Estado do contato" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mavo-field"><option value="">Todos os contatos</option><option value="unblocked">Disponíveis para atendimento</option><option value="blocked">Bloqueados</option></select></label></div>

      {loading ? (
        <div className="grid gap-3"><div className="h-16 rounded-2xl skeleton" /><div className="h-16 rounded-2xl skeleton" /><div className="h-16 rounded-2xl skeleton" /></div>
      ) : contacts.length === 0 ? (
        <EmptyState title="Nenhum contato encontrado com este filtro." description={search ? 'Altere a busca ou limpe o filtro para ver todos os contatos disponíveis.' : 'Os contatos aparecerão aqui depois do primeiro atendimento.'} />
      ) : (
        <><div className="mavo-card hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[.14em] text-slate-400 dark:border-slate-700"><tr><th className="px-5 py-4">Contato</th><th className="px-5 py-4">Telefone</th><th className="px-5 py-4">Última interação</th><th className="px-5 py-4">Estado</th><th className="px-5 py-4 text-right">Ações</th></tr></thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-800/50">
                  <td className="px-5 py-4 font-bold text-slate-800 dark:text-slate-100">
                    <div className="flex items-center gap-3">
                      <ContactAvatar contact={contact} onPreview={setAvatarPreview} />
                      <div className="min-w-0">
                        <span className="block truncate">{contact.name || 'Sem nome'}</span>
                        {contact.botDisabled && (
                          <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                            Bot desativado
                          </span>
                        )}
                        {contact.internalNote && <span className="mt-1 block max-w-[240px] truncate text-xs font-normal text-slate-500">Nota: {contact.internalNote}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-slate-600 dark:text-slate-300">{contact.phoneNumber || '—'}</td>
                  <td className="px-5 py-4 text-xs text-slate-500">{contact.lastInteraction ? new Date(contact.lastInteraction).toLocaleString('pt-BR') : 'Sem histórico'}</td>
                  <td className="px-5 py-4"><ContactStatusBadge contact={contact} /></td>
                  <td className="px-5 py-4">{contactActions(contact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div><div className="grid gap-3 md:hidden">{contacts.map((contact) => <article key={contact.id} className="mavo-card space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><ContactAvatar contact={contact} onPreview={setAvatarPreview} /><div className="min-w-0"><h3 className="truncate font-bold text-slate-800 dark:text-slate-100">{contact.name || 'Sem nome'}</h3><p className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">{contact.phoneNumber || '—'}</p>{contact.botDisabled && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">Bot desativado</span>}</div></div><ContactStatusBadge contact={contact} className="shrink-0" /></div>{contact.internalNote && <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">Nota: {contact.internalNote}</p>}<p className="text-xs text-slate-500">{contact.lastInteraction ? `Última interação: ${new Date(contact.lastInteraction).toLocaleString('pt-BR')}` : 'Sem histórico de atendimento'}</p>{contactActions(contact, true)}</article>)}</div></>
      )}
      {!loading && <Pagination page={page} pageSize={pageSize} total={total} itemLabel="contatos" onPageChange={setPage} />}

      {noteModal && <Dialog title="Nota interna" description={noteModal.name} onClose={() => { if (!savingNote) setNoteModal(null); }}><form onSubmit={(event) => { event.preventDefault(); void saveNote(); }} className="p-6"><label htmlFor="contact-internal-note" className="sr-only">Nota interna</label><textarea id="contact-internal-note" value={noteValue} onChange={(event) => setNoteValue(event.target.value)} rows={5} placeholder="Informação visível somente para a equipe" className="mavo-field" /><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setNoteModal(null)} disabled={savingNote} className="mavo-button-secondary">Cancelar</button><button disabled={savingNote} className="mavo-button-primary">{savingNote ? 'Salvando...' : 'Salvar nota'}</button></div></form></Dialog>}
      {avatarPreview?.avatarUrl && (
        <AvatarPreviewDialog
          avatarUrl={avatarPreview.avatarUrl}
          contactName={avatarPreview.name || 'Contato'}
          onClose={() => setAvatarPreview(null)}
        />
      )}
    </div></main>
  );
};

export default Contacts;
