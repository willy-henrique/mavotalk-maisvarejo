import React, { useState, useEffect, useCallback, useDeferredValue, useRef } from 'react';
import { apiFetch, apiPost, apiPatch } from '../../services/api';
import { Dialog } from '../ui/Dialog';
import { EmptyState, ErrorState, LoadingState } from '../ui/PageState';
import { Pagination } from '../ui/Pagination';
import { renderQuickReplyPreview } from '../../services/quickReplyPreview';

type QuickReply = {
  id: string;
  name: string;
  content: string;
  category?: string | null;
  createdAt?: string;
};

const VARIABLE_GUIDE = (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-950">
    <p className="mb-2 font-bold text-slate-800 dark:text-slate-100">Você pode usar variáveis:</p>
    <ul className="mb-3 space-y-1 text-slate-600 dark:text-slate-300">
      <li>
        <code className="bg-slate-200 px-1 rounded">&#123;saudacao&#125;</code> → Saudação automática (Bom dia / Boa
        tarde / Boa noite)
      </li>
      <li>
        <code className="bg-slate-200 px-1 rounded">&#123;user&#125;</code> → Seu nome
      </li>
      <li>
        <code className="bg-slate-200 px-1 rounded">&#123;cliente&#125;</code> → Nome completo do cliente
      </li>
      <li>
        <code className="bg-slate-200 px-1 rounded">&#123;primeiro_nome&#125;</code> → Primeiro nome do cliente
      </li>
      <li>
        <code className="bg-slate-200 px-1 rounded">&#123;ticket&#125;</code> → Número do atendimento
      </li>
      <li>
        <code className="bg-slate-200 px-1 rounded">&#123;data&#125;</code> → Data atual
      </li>
      <li>
        <code className="bg-slate-200 px-1 rounded">&#123;hora&#125;</code> → Hora atual
      </li>
    </ul>
    <p className="italic text-slate-500 dark:text-slate-400">
      Exemplo: <code className="bg-slate-200 px-1 rounded">&#123;saudacao&#125;, &#123;primeiro_nome&#125;! Me chamo &#123;user&#125; e vou te ajudar.</code>
    </p>
  </div>
);

const QuickReplyManagement: React.FC = () => {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<QuickReply | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [total, setTotal] = useState(0);
  const deferredSearch = useDeferredValue(search);
  const requestRef = useRef(0);

  const fetchItems = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (deferredSearch.trim()) params.set('q', deferredSearch.trim());
      const res = await apiFetch(`/api/quick-replies?${params.toString()}`, { method: 'GET' });
      const data = (await res.json()) as { items?: QuickReply[]; total?: number };
      if (request !== requestRef.current) return;
      if (res.ok && Array.isArray(data.items)) {
        setItems(data.items);
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setError('');
      } else {
        setError('Não foi possível carregar as respostas rápidas.');
      }
    } catch {
      if (request !== requestRef.current) return;
      setError('Não foi possível carregar as respostas rápidas.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [deferredSearch, page]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const pageSize = 25;

  const openCreate = () => {
    setEditingId(null);
    setFormName('');
    setFormContent('');
    setFormCategory('');
    setSubmitError('');
    setNotice('');
    setShowModal(true);
  };

  const openEdit = (item: QuickReply) => {
    setEditingId(item.id);
    setFormName(item.name);
    setFormContent(item.content);
    setFormCategory(item.category || '');
    setSubmitError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setSubmitError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitting(true);
    try {
      if (editingId) {
        await apiPatch(`/api/quick-replies/${editingId}`, {
          name: formName.trim(),
          content: formContent.trim(),
          category: formCategory.trim() || null,
        });
      } else {
        await apiPost('/api/quick-replies', {
          name: formName.trim(),
          content: formContent.trim(),
          category: formCategory.trim() || null,
        });
      }
      await fetchItems();
      closeModal();
      setNotice(editingId ? 'Resposta rápida atualizada.' : 'Resposta rápida criada.');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError('');
    setNotice('');
    try {
      const res = await apiFetch(`/api/quick-replies/${pendingDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Não foi possível excluir a resposta rápida.');
      setPendingDelete(null);
      setNotice('Resposta rápida excluída.');
      await fetchItems();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir a resposta rápida.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="mavo-page"><div className="mavo-page-content">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Respostas rápidas</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Atalhos e variáveis para envio rápido no chat. Use <kbd className="rounded bg-slate-200 px-1 dark:bg-slate-800">/</kbd> no campo de mensagem.</p>
        </div>
        <button
          onClick={openCreate}
          className="mavo-button-primary"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
          Nova resposta
        </button>
      </div>

      {error && <ErrorState className="mb-5" description={error} action={<button type="button" onClick={() => void fetchItems()} disabled={loading} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}
      {notice && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</div>}
      <label className="mb-5 block max-w-xl"><span className="sr-only">Buscar respostas rápidas</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por atalho, conteúdo ou categoria" className="mavo-field" /></label>

      {loading ? (
        <LoadingState title="Carregando respostas rápidas…" />
      ) : items.length === 0 ? (
        <EmptyState title={search.trim() ? 'Nenhuma resposta encontrada.' : 'Nenhuma resposta rápida cadastrada.'} description={search.trim() ? 'Altere a busca ou limpe o filtro para ver os atalhos cadastrados.' : 'Crie atalhos consistentes para reduzir o tempo de resposta da equipe.'} action={search.trim() ? <button type="button" onClick={() => setSearch('')} className="mavo-button-secondary">Limpar busca</button> : <button type="button" onClick={openCreate} className="mavo-button-primary">Criar a primeira resposta rápida</button>} />
      ) : (
        <><div className="mavo-card hidden overflow-x-auto p-0 md:block">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">Atalho</th>
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">Mensagem</th>
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider w-24">Mídia</th>
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider w-28">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{item.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-sm max-w-md">
                    <span className="whitespace-pre-wrap break-words line-clamp-2 block" title={item.content}>{item.content}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-sm">—</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => openEdit(item)} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-blue-400" title="Editar" aria-label={`Editar ${item.name}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" /></svg>
                      </button>
                      <button type="button" onClick={() => setPendingDelete(item)} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-rose-400" title="Excluir" aria-label={`Excluir ${item.name}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div><div className="grid gap-3 md:hidden">{items.map((item) => <article key={item.id} className="mavo-card space-y-3 p-4"><div className="flex items-start justify-between gap-3"><h3 className="min-w-0 truncate font-bold text-slate-800 dark:text-slate-100">{item.name}</h3><div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => openEdit(item)} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-blue-400" aria-label={`Editar ${item.name}`}>Editar</button><button type="button" onClick={() => setPendingDelete(item)} className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30" aria-label={`Excluir ${item.name}`}>Excluir</button></div></div><p className="whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{item.content}</p>{item.category && <p className="text-xs font-semibold text-slate-500">Categoria: {item.category}</p>}</article>)}</div></>
      )}
      {!loading && <Pagination page={page} pageSize={pageSize} total={total} itemLabel="respostas" onPageChange={setPage} />}

      {showModal && (
        <Dialog
          title={editingId ? 'Editar resposta rápida' : 'Nova resposta rápida'}
          description="Use variáveis para personalizar a mensagem no Inbox."
          onClose={() => { if (!submitting) closeModal(); }}
        >
            <div className="p-6">
              {VARIABLE_GUIDE}
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="quick-reply-name" className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome</label>
                  <input
                    id="quick-reply-name"
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Ex: Saudação inicial"
                    data-autofocus
                    className="mavo-field"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="quick-reply-content" className="block text-xs font-bold text-slate-500 uppercase mb-1">Conteúdo</label>
                  <textarea
                    id="quick-reply-content"
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="{saudacao}, {primeiro_nome}! Me chamo {user}."
                    rows={4}
                    className="mavo-field"
                    required
                  />
                </div>
                <section aria-live="polite" aria-label="Pré-visualização da resposta" className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
                  <p className="text-xs font-bold uppercase tracking-wide text-blue-800 dark:text-blue-200">Pré-visualização</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">{formContent.trim() ? renderQuickReplyPreview(formContent) : 'Digite o conteúdo para visualizar a mensagem.'}</p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Exemplo local com dados fictícios; a mensagem real usa o contato e o atendimento atuais.</p>
                </section>
                <div>
                  <label htmlFor="quick-reply-category" className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoria (opcional)</label>
                  <input
                    id="quick-reply-category"
                    type="text"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    placeholder="Ex: Saudação"
                    className="mavo-field"
                  />
                </div>
                {submitError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">{submitError}</p>}
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={submitting}
                    className="mavo-button-secondary"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !formName.trim() || !formContent.trim()}
                    className="mavo-button-primary"
                  >
                    {submitting ? 'Salvando...' : editingId ? 'Atualizar' : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
        </Dialog>
      )}
      {pendingDelete && <Dialog title="Excluir resposta rápida" description={`A resposta “${pendingDelete.name}” deixará de aparecer no Inbox.`} onClose={() => { if (!deleting) setPendingDelete(null); }}><div className="p-6"><p className="text-sm text-slate-600 dark:text-slate-300">Esta ação não pode ser desfeita.</p><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={deleting} onClick={() => setPendingDelete(null)} className="mavo-button-secondary">Cancelar</button><button type="button" disabled={deleting} onClick={() => void handleDelete()} className="mavo-button bg-rose-600 text-white hover:bg-rose-700">{deleting ? 'Excluindo...' : 'Excluir resposta'}</button></div></div></Dialog>}
    </div></main>
  );
};

export default QuickReplyManagement;
