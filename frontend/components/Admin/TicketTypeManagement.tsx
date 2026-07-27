import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiPost, apiPatch } from '../../services/api';
import { Icons } from '../../constants';
import { Dialog } from '../ui/Dialog';

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
  const [loadError, setLoadError] = useState('');
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
    setLoadError('');
    try {
      const res = await apiFetch('/api/queues', { method: 'GET' });
      const data = (await res.json()) as { queues?: Queue[] };
      if (res.ok && Array.isArray(data.queues)) {
        setQueues(data.queues);
      } else {
        setLoadError('Não foi possível carregar as filas. Tente novamente.');
      }
    } catch {
      setLoadError('Não foi possível carregar as filas. Verifique a conexão e tente novamente.');
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
    <main className="mavo-page"><div className="mavo-page-content">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Filas e automações</h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400">Configure a opção do menu do bot, cor operacional e SLA de primeira resposta.</p>
        </div>
        <button
          onClick={openCreate}
          className="mavo-button-primary"
        >
          <Icons.Settings className="w-5 h-5" />
          Nova fila
        </button>
      </div>

      {loadError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"><span>{loadError}</span><button type="button" onClick={() => void fetchQueues()} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button></div>}
      {loading ? (
        <div className="text-slate-500">Carregando...</div>
      ) : queues.length === 0 ? (
        <div className="mavo-card p-10 text-center text-slate-500 dark:text-slate-400">
          <p className="mb-4">Nenhuma fila cadastrada.</p>
          <button onClick={openCreate} className="text-blue-600 font-bold hover:underline">
            Criar a primeira fila
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {queues
            .sort((a, b) => a.menuOption - b.menuOption)
            .map((q) => (
              <div
                key={q.id}
                className="mavo-card group p-6 transition hover:shadow-xl"
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

                <h3 className="mb-4 text-lg font-bold text-slate-800 dark:text-slate-100">{q.name}</h3>

                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-400 uppercase tracking-widest">Opção no menu</span>
                    <span className="text-slate-700 dark:text-slate-200">{q.menuOption}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-400 uppercase tracking-widest">SLA Resposta</span>
                    <span className="text-slate-700 dark:text-slate-200">{q.defaultSlaMins} min</span>
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
        <Dialog title={editingId ? 'Editar fila' : 'Nova fila'} description="A opção escolhida será exibida no menu do bot quando a fila estiver ativa." onClose={() => { if (!submitting) closeModal(); }}>
            <div className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="queue-name" className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome</label>
                <input
                  id="queue-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Sped Fiscal"
                  className="mavo-field"
                  required
                />
              </div>
              <div>
                <label htmlFor="queue-menu-option" className="block text-xs font-bold text-slate-500 uppercase mb-1">Opção no menu (número)</label>
                <input
                  id="queue-menu-option"
                  type="number"
                  min={1}
                  max={99}
                  value={formMenuOption}
                  onChange={(e) => setFormMenuOption(Number(e.target.value))}
                  className="mavo-field"
                  required
                />
              </div>
              <div>
                <label htmlFor="queue-color" className="block text-xs font-bold text-slate-500 uppercase mb-1">Cor</label>
                <input
                  id="queue-color"
                  type="color"
                  value={formColorHex}
                  onChange={(e) => setFormColorHex(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-200 cursor-pointer"
                />
                <input aria-label="Código hexadecimal da cor"
                  type="text"
                  value={formColorHex}
                  onChange={(e) => setFormColorHex(e.target.value)}
                  placeholder="#64748b"
                  className="mavo-field mt-2 py-2"
                />
              </div>
              <div>
                <label htmlFor="queue-sla" className="block text-xs font-bold text-slate-500 uppercase mb-1">SLA Resposta (minutos)</label>
                <input
                  id="queue-sla"
                  type="number"
                  min={5}
                  max={1440}
                  value={formDefaultSlaMins}
                  onChange={(e) => setFormDefaultSlaMins(Number(e.target.value))}
                  className="mavo-field"
                  required
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div><p className="text-sm font-bold text-slate-800 dark:text-slate-100">Ativo no menu do chatbot</p><p className="text-xs text-slate-500 dark:text-slate-400">Filas inativas não aparecem como opção para o cliente.</p></div>
                <button type="button" role="switch" aria-checked={formIsActive} aria-label="Alternar fila ativa no menu do chatbot" onClick={() => setFormIsActive((value) => !value)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${formIsActive ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}><span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${formIsActive ? 'translate-x-6' : 'translate-x-1'}`} /></button>
              </div>
              {submitError && <p className="text-sm text-rose-600">{submitError}</p>}
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
                  disabled={submitting || !formName.trim()}
                  className="mavo-button-primary"
                >
                  {submitting ? 'Salvando...' : editingId ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
            </div>
        </Dialog>
      )}
    </div></main>
  );
};

export default TicketTypeManagement;
