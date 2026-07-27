import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, apiPatch, apiPost } from '../services/api';
import { Dialog } from './ui/Dialog';

type ApiContact = {
  id: string;
  name: string;
  phoneNumber: string;
  lastInteraction: string | null;
  status: 'ativo' | 'encerrado';
  blocked: boolean;
  internalNote: string | null;
  lastConversationId: string | null;
};

const Contacts: React.FC = () => {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [noteModal, setNoteModal] = useState<ApiContact | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [blockingId, setBlockingId] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/contacts', { method: 'GET' });
      const data = (await res.json()) as { contacts?: ApiContact[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Não foi possível carregar os contatos.');
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os contatos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchContacts(); }, [fetchContacts]);

  const filtered = contacts.filter((contact) => contact.name.toLowerCase().includes(search.toLowerCase()) || contact.phoneNumber.includes(search));

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

  return (
    <main className="mavo-page"><div className="mavo-page-content">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">{contacts.length} contato{contacts.length === 1 ? '' : 's'} com histórico no Mavo.</p>
        <button type="button" onClick={() => void fetchContacts()} disabled={loading} className="mavo-button-secondary">{loading ? 'Atualizando...' : 'Atualizar lista'}</button>
      </div>
      {error && <div role="alert" className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}
      {notice && <div role="status" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</div>}
      <label className="mb-6 block max-w-xl"><span className="sr-only">Buscar contatos</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" className="mavo-field" /></label>

      {loading ? (
        <div className="grid gap-3"><div className="h-16 rounded-2xl skeleton" /><div className="h-16 rounded-2xl skeleton" /><div className="h-16 rounded-2xl skeleton" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">Nenhum contato encontrado com este filtro.</div>
      ) : (
        <div className="mavo-card overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[.14em] text-slate-400 dark:border-slate-700"><tr><th className="px-5 py-4">Contato</th><th className="px-5 py-4">Telefone</th><th className="px-5 py-4">Última interação</th><th className="px-5 py-4">Estado</th><th className="px-5 py-4 text-right">Ações</th></tr></thead>
            <tbody>
              {filtered.map((contact) => (
                <tr key={contact.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-800/50">
                  <td className="px-5 py-4 font-bold text-slate-800 dark:text-slate-100"><span className="block">{contact.name || 'Sem nome'}</span>{contact.internalNote && <span className="mt-1 block max-w-[240px] truncate text-xs font-normal text-slate-500">Nota: {contact.internalNote}</span>}</td>
                  <td className="px-5 py-4 font-mono text-xs text-slate-600 dark:text-slate-300">{contact.phoneNumber || '—'}</td>
                  <td className="px-5 py-4 text-xs text-slate-500">{contact.lastInteraction ? new Date(contact.lastInteraction).toLocaleString('pt-BR') : 'Sem histórico'}</td>
                  <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${contact.blocked ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200' : contact.status === 'ativo' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{contact.blocked ? 'Bloqueado' : contact.status}</span></td>
                  <td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => void startConversation(contact)} disabled={startingId === contact.id || contact.blocked} className="mavo-button-primary min-h-0 rounded-lg px-3 py-2 text-xs">{startingId === contact.id ? 'Abrindo...' : 'Conversar'}</button><button type="button" onClick={() => openConversation(contact)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Histórico</button><button type="button" onClick={() => { setNoteModal(contact); setNoteValue(contact.internalNote || ''); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Nota</button><button type="button" disabled={blockingId === contact.id} onClick={() => void toggleBlock(contact)} className={`rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${contact.blocked ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-200'}`}>{blockingId === contact.id ? 'Atualizando…' : contact.blocked ? 'Desbloquear' : 'Bloquear'}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {noteModal && <Dialog title="Nota interna" description={noteModal.name} onClose={() => { if (!savingNote) setNoteModal(null); }}><form onSubmit={(event) => { event.preventDefault(); void saveNote(); }} className="p-6"><label htmlFor="contact-internal-note" className="sr-only">Nota interna</label><textarea id="contact-internal-note" value={noteValue} onChange={(event) => setNoteValue(event.target.value)} rows={5} placeholder="Informação visível somente para a equipe" className="mavo-field" /><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setNoteModal(null)} disabled={savingNote} className="mavo-button-secondary">Cancelar</button><button disabled={savingNote} className="mavo-button-primary">{savingNote ? 'Salvando...' : 'Salvar nota'}</button></div></form></Dialog>}
    </div></main>
  );
};

export default Contacts;
