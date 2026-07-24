import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiPost, apiPatch } from '../../services/api';

type QuickReply = {
  id: string;
  name: string;
  content: string;
  category?: string | null;
  createdAt?: string;
};

const VARIABLE_GUIDE = (
  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm">
    <p className="font-bold text-slate-800 mb-2">Você pode usar variáveis:</p>
    <ul className="space-y-1 text-slate-600 mb-3">
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
    <p className="text-slate-500 italic">
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

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/quick-replies', { method: 'GET' });
      const data = (await res.json()) as { quickReplies?: QuickReply[] };
      if (res.ok && Array.isArray(data.quickReplies)) {
        setItems(data.quickReplies);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const openCreate = () => {
    setEditingId(null);
    setFormName('');
    setFormContent('');
    setFormCategory('');
    setSubmitError('');
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
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta resposta rápida?')) return;
    try {
      const res = await apiFetch(`/api/quick-replies/${id}`, { method: 'DELETE' });
      if (res.ok) await fetchItems();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 md:p-8 flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-800/95 transition-colors">
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Respostas Rápidas</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Atalhos e variáveis para envio rápido no chat (use / no campo de mensagem).</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
          NOVA RESPOSTA
        </button>
      </div>

      {loading ? (
        <div className="text-slate-400 py-8">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-12 text-center text-slate-500">
          <p className="mb-4">Nenhuma resposta rápida cadastrada.</p>
          <button onClick={openCreate} className="text-blue-600 dark:text-blue-400 font-bold hover:underline">
            Criar a primeira resposta rápida
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 shadow-sm dark:shadow-none">
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
                      <button onClick={() => openEdit(item)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" title="Editar">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" /></svg>
                      </button>
                      <button onClick={() => handleDelete(item.id)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-rose-600 dark:hover:text-rose-400 transition-colors" title="Excluir">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => !submitting && closeModal()}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h2 className="text-xl font-bold text-slate-800 mb-4">
                {editingId ? 'Editar resposta rápida' : 'Nova resposta rápida'}
              </h2>
              {VARIABLE_GUIDE}
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Ex: Saudação inicial"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Conteúdo</label>
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="{saudacao}, {primeiro_nome}! Me chamo {user}."
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoria (opcional)</label>
                  <input
                    type="text"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    placeholder="Ex: Saudação"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                {submitError && <p className="text-sm text-rose-600">{submitError}</p>}
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={submitting}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !formName.trim() || !formContent.trim()}
                    className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitting ? 'Salvando...' : editingId ? 'Atualizar' : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuickReplyManagement;
