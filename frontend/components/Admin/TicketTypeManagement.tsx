import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiPost, apiPatch } from '../../services/api';
import { Icons } from '../../constants';

type Queue = {
  id: string;
  name: string;
  menuOption: number;
  colorHex: string;
  defaultSlaMins: number;
  isActive: boolean;
};

const TicketTypeManagement: React.FC = () => {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formMenuOption, setFormMenuOption] = useState(1);
  const [formColorHex, setFormColorHex] = useState('#64748b');
  const [formDefaultSlaMins, setFormDefaultSlaMins] = useState(30);
  const [formIsActive, setFormIsActive] = useState(true);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchQueues = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/queues', { method: 'GET' });
      const data = (await res.json()) as { queues?: Queue[] };
      if (res.ok && Array.isArray(data.queues)) {
        setQueues(data.queues);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueues();
  }, [fetchQueues]);

  const openCreate = () => {
    setEditingId(null);
    setFormName('');
    setFormMenuOption(Math.max(1, ...queues.map((q) => q.menuOption)) + 1);
    setFormColorHex('#64748b');
    setFormDefaultSlaMins(30);
    setFormIsActive(true);
    setSubmitError('');
    setShowModal(true);
  };

  const openEdit = (q: Queue) => {
    setEditingId(q.id);
    setFormName(q.name);
    setFormMenuOption(q.menuOption);
    setFormColorHex(q.colorHex);
    setFormDefaultSlaMins(q.defaultSlaMins);
    setFormIsActive(q.isActive);
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
      const body = {
        name: formName.trim(),
        menuOption: formMenuOption,
        colorHex: formColorHex,
        defaultSlaMins: formDefaultSlaMins,
        isActive: formIsActive,
      };
      if (editingId) {
        await apiPatch(`/api/queues/${editingId}`, body);
      } else {
        await apiPost('/api/queues', body);
      }
      await fetchQueues();
      closeModal();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-white">
      <div className="flex justify-between items-end mb-10">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Tipos de Chamado</h1>
          <p className="text-slate-500 font-medium">Configure as categorias e cores da triagem (menu do chatbot).</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center gap-2"
        >
          <Icons.Settings className="w-5 h-5" />
          Nova Categoria
        </button>
      </div>

      {loading ? (
        <div className="text-slate-500">Carregando...</div>
      ) : queues.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
          <p className="mb-4">Nenhuma categoria cadastrada.</p>
          <button onClick={openCreate} className="text-blue-600 font-bold hover:underline">
            Criar a primeira categoria
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {queues
            .sort((a, b) => a.menuOption - b.menuOption)
            .map((q) => (
              <div
                key={q.id}
                className="border border-slate-200 rounded-[32px] p-6 hover:shadow-xl hover:shadow-slate-100 transition-all group"
              >
                <div className="flex justify-between items-start mb-6">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg"
                    style={{ backgroundColor: q.colorHex }}
                  >
                    {q.name.charAt(0)}
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => openEdit(q)}
                      className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600"
                      title="Editar"
                    >
                      <Icons.Settings className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <h3 className="text-lg font-bold text-slate-800 mb-4">{q.name}</h3>

                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-400 uppercase tracking-widest">Opção no menu</span>
                    <span className="text-slate-700">{q.menuOption}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-400 uppercase tracking-widest">SLA Resposta</span>
                    <span className="text-slate-700">{q.defaultSlaMins} min</span>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between">
                  <span
                    className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                      q.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {q.isActive ? 'Ativo no Menu' : 'Inativo'}
                  </span>
                  <span className="text-[10px] font-black text-slate-400 uppercase">Cor: {q.colorHex}</span>
                </div>
              </div>
            ))}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => !submitting && closeModal()}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-slate-800 mb-4">
              {editingId ? 'Editar categoria' : 'Nova categoria'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Sped Fiscal"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Opção no menu (número)</label>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={formMenuOption}
                  onChange={(e) => setFormMenuOption(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cor</label>
                <input
                  type="color"
                  value={formColorHex}
                  onChange={(e) => setFormColorHex(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-200 cursor-pointer"
                />
                <input
                  type="text"
                  value={formColorHex}
                  onChange={(e) => setFormColorHex(e.target.value)}
                  placeholder="#64748b"
                  className="w-full mt-2 px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">SLA Resposta (minutos)</label>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={formDefaultSlaMins}
                  onChange={(e) => setFormDefaultSlaMins(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="formIsActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <label htmlFor="formIsActive" className="text-sm font-medium text-slate-700">
                  Ativo no menu do chatbot
                </label>
              </div>
              {submitError && <p className="text-sm text-rose-600">{submitError}</p>}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !formName.trim()}
                  className="px-6 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Salvando...' : editingId ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketTypeManagement;
