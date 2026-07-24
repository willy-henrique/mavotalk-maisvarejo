import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, apiPatch } from '../services/api';

type ApiContact = {
  id: string;
  name: string;
  phoneNumber: string;
  lastMessage: string | null;
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

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/contacts', { method: 'GET' });
      const data = (await res.json()) as { contacts?: ApiContact[] };
      if (res.ok && Array.isArray(data.contacts)) {
        setContacts(data.contacts);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phoneNumber.includes(search)
  );

  const openConversation = (c: ApiContact) => {
    if (c.lastConversationId) {
      navigate(`/inbox?conversation=${c.lastConversationId}`);
    } else {
      navigate('/inbox');
    }
  };

  const handleBlock = async (c: ApiContact) => {
    try {
      await apiPatch(`/api/contacts/${c.id}`, { blocked: !c.blocked });
      await fetchContacts();
    } catch (e) {
      console.error(e);
    }
  };

  const openNote = (c: ApiContact) => {
    setNoteModal(c);
    setNoteValue(c.internalNote || '');
  };

  const saveNote = async () => {
    if (!noteModal) return;
    setSavingNote(true);
    try {
      await apiPatch(`/api/contacts/${noteModal.id}`, {
        internalNote: noteValue.trim() || null,
      });
      setNoteModal(null);
      await fetchContacts();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="p-6 md:p-8 flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-800/95 transition-colors">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Contatos</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Todos que já conversaram.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar..."
          className="px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none w-56"
        />
        <button type="button" className="p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-white transition-colors" title="Importar">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M11.47 2.47a.75.75 0 011.06 0l4.5 4.5a.75.75 0 01-1.06 1.06l-3.22-3.22V16.5a.75.75 0 01-1.5 0V4.81l-3.22 3.22a.75.75 0 11-1.06-1.06l4.5-4.5z" clipRule="evenodd" />
          </svg>
        </button>
        <button type="button" className="p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-white transition-colors" title="Exportar">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M12 2.25a.75.75 0 01.75.75v11.69l3.22-3.22a.75.75 0 111.06 1.06l-4.5 4.5a.75.75 0 01-1.06 0l-4.5-4.5a.75.75 0 111.06-1.06l3.22 3.22V2.25A.75.75 0 0112 2.25zM3 16.5v-2.25a.75.75 0 01.75-.75h16.5a.75.75 0 01.75.75V16.5m-16.5 4.5h16.5a.75.75 0 00.75-.75V18a.75.75 0 00-.75-.75H3.75A.75.75 0 003 18v1.75c0 .414.336.75.75.75z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          onClick={() => navigate('/inbox')}
          className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors"
        >
          IMPORTAR CONTATOS
        </button>
        <button
          onClick={() => navigate('/inbox')}
          className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors"
        >
          ADICIONAR CONTATO
        </button>
      </div>

      {loading ? (
        <div className="text-slate-400 py-8">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-12 text-center text-slate-500">
          Nenhum contato encontrado.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 shadow-sm dark:shadow-none">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">Nome</th>
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">Serviço</th>
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">Id</th>
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-sm">whatsapp</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-sm font-mono">{c.id}</td>
                  <td className="px-4 py-3 text-slate-500 text-sm">—</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openConversation(c)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" title="Conversa WhatsApp">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.865 9.865 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      </button>
                      <button onClick={() => openNote(c)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-white transition-colors" title="Observação">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" /></svg>
                      </button>
                      <button onClick={() => handleBlock(c)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-rose-600 dark:hover:text-rose-400 transition-colors" title={c.blocked ? 'Desbloquear' : 'Bloquear'}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v2.5a.75.75 0 01-1.5 0v-2.5A.75.75 0 0110 6zM10 18a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {noteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => !savingNote && setNoteModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-slate-800 mb-2">Observação interna - {noteModal.name}</h3>
            <textarea
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              placeholder="Nota interna (visível apenas para a equipe)"
              rows={4}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => !savingNote && setNoteModal(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={saveNote}
                disabled={savingNote}
                className="px-6 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                {savingNote ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Contacts;
