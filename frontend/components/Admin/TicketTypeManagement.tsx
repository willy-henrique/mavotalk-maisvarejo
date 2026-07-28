import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiDelete, apiFetch, apiPost, apiPatch } from '../../services/api';
import { Icons } from '../../constants';
import { Dialog } from '../ui/Dialog';
import { EmptyState, ErrorState, LoadingState } from '../ui/PageState';
import { StatusBadge } from '../ui/StatusBadge';

type Queue = {
  id: string;
  name: string;
  menuOption: number;
  colorHex: string;
  defaultSlaMins: number;
  isActive: boolean;
};

const QueueStatusBadge: React.FC<{ queue: Queue; label?: string; className?: string }> = ({ queue, label, className = '' }) => (
  <StatusBadge tone={queue.isActive ? 'success' : 'neutral'} className={className}>
    {label || (queue.isActive ? 'Ativa' : 'Inativa')}
  </StatusBadge>
);

const TicketTypeManagement: React.FC = () => {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
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
  const [deleteCandidate, setDeleteCandidate] = useState<Queue | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const requestRef = useRef(0);

  const fetchQueues = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const res = await apiFetch('/api/queues', { method: 'GET' });
      const data = (await res.json()) as { queues?: Queue[] };
      if (request !== requestRef.current) return false;
      if (res.ok && Array.isArray(data.queues)) {
        setQueues(data.queues);
        return true;
      } else {
        setLoadError('Não foi possível carregar as filas. Tente novamente.');
        return false;
      }
    } catch {
      if (request !== requestRef.current) return false;
      setLoadError('Não foi possível carregar as filas. Verifique a conexão e tente novamente.');
      return false;
    } finally {
      if (request === requestRef.current) setLoading(false);
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
    setNotice('');
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
    setNotice('');
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
    setNotice('');
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
      setNotice(editingId ? 'Fila atualizada com sucesso.' : 'Fila criada com sucesso.');
      closeModal();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  };

  const restoreDefaultMenu = async () => {
    setConfirmRestore(false);
    setRestoring(true);
    setSubmitError('');
    setNotice('');
    try {
      const result = await apiPost<{ created: number; updated: number }>('/api/queues/supermarket-preset');
      await fetchQueues();
      setNotice(`Menu padrão restaurado: ${result.created} fila(s) criada(s) e ${result.updated} reativada(s).`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Não foi possível restaurar o menu padrão.');
    } finally {
      setRestoring(false);
    }
  };

  const removeQueue = async () => {
    if (!deleteCandidate) return;
    setDeleting(true);
    setSubmitError('');
    setNotice('');
    try {
      await apiDelete(`/api/queues/${deleteCandidate.id}`);
      setDeleteCandidate(null);
      await fetchQueues();
      setNotice('Fila excluída com sucesso.');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Não foi possível excluir a fila.');
    } finally {
      setDeleting(false);
    }
  };

  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const filteredQueues = queues
    .filter((queue) => !normalizedSearch || queue.name.toLocaleLowerCase('pt-BR').includes(normalizedSearch))
    .filter((queue) => statusFilter === 'all' || (statusFilter === 'active' ? queue.isActive : !queue.isActive))
    .slice()
    .sort((a, b) => a.menuOption - b.menuOption || a.name.localeCompare(b.name, 'pt-BR'));

  return (
    <main className="mavo-page"><div className="mavo-page-content">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Filas e automações</h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400">Configure a opção do menu do bot, cor operacional e SLA de primeira resposta.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirmRestore(true)}
            disabled={restoring}
            className="mavo-button-secondary"
          >
            {restoring ? 'Restaurando...' : 'Restaurar menu padrão'}
          </button>
          <button
            onClick={openCreate}
            className="mavo-button-primary"
          >
            <Icons.Settings className="w-5 h-5" />
            Nova fila
          </button>
        </div>
      </div>

      {notice && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</div>}
      {loadError && <ErrorState className="mb-5" description={loadError} action={<button type="button" onClick={() => void fetchQueues()} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}
      {!loading && queues.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-3">
          <label className="block min-w-[16rem] flex-1"><span className="sr-only">Buscar filas</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome da fila" className="mavo-field" /></label>
          <label className="min-w-44"><span className="sr-only">Filtrar por status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="mavo-field"><option value="all">Todos os status</option><option value="active">Ativas no menu</option><option value="inactive">Inativas</option></select></label>
        </div>
      )}
      {loading ? (
        <LoadingState title="Carregando filas e automações…" />
      ) : queues.length === 0 ? (
        <EmptyState title="Nenhuma fila cadastrada." description="Crie a primeira fila para disponibilizar uma opção no menu do bot e direcionar os atendimentos." action={<button type="button" onClick={openCreate} className="mavo-button-primary">Criar a primeira fila</button>} />
      ) : filteredQueues.length === 0 ? (
        <EmptyState title="Nenhuma fila encontrada." description="Altere a busca ou limpe os filtros para visualizar as filas cadastradas." action={<button type="button" onClick={() => { setSearch(''); setStatusFilter('all'); }} className="mavo-button-secondary">Limpar filtros</button>} />
      ) : filteredQueues.length > 8 ? (
        <><div className="mavo-card hidden overflow-x-auto p-0 md:block">
          <table className="w-full min-w-[720px] text-left">
            <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Fila</th><th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Menu</th><th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">SLA</th><th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th><th scope="col" className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ações</th></tr></thead>
            <tbody>{filteredQueues.map((queue) => <tr key={queue.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/80 dark:hover:bg-slate-800/50"><td className="px-4 py-3"><span className="mr-3 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: queue.colorHex }} aria-hidden="true" /><span className="font-medium text-slate-800 dark:text-slate-200">{queue.name}</span></td><td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{queue.menuOption}</td><td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{queue.defaultSlaMins} min</td><td className="px-4 py-3"><QueueStatusBadge queue={queue} /></td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><button type="button" onClick={() => openEdit(queue)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Editar</button><button type="button" onClick={() => { setDeleteCandidate(queue); setSubmitError(''); }} className="mavo-button-danger min-h-0 px-3 py-2 text-xs">Excluir</button></div></td></tr>)}</tbody>
          </table>
        </div><div className="grid gap-3 md:hidden">{filteredQueues.map((queue) => <article key={queue.id} className="mavo-card space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: queue.colorHex }} aria-hidden="true" /><h3 className="truncate font-bold text-slate-800 dark:text-slate-100">{queue.name}</h3></div><QueueStatusBadge queue={queue} className="shrink-0" /></div><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="font-semibold text-slate-500">Opção no menu</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{queue.menuOption}</dd></div><div><dt className="font-semibold text-slate-500">SLA</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{queue.defaultSlaMins} min</dd></div></dl><div className="flex flex-wrap gap-2"><button type="button" onClick={() => openEdit(queue)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Editar</button><button type="button" onClick={() => { setDeleteCandidate(queue); setSubmitError(''); }} className="mavo-button-danger min-h-0 px-3 py-2 text-xs">Excluir</button></div></article>)}</div></>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredQueues.map((q) => (
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
                  <div className="flex gap-2 opacity-0 transition-all group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => openEdit(q)}
                      className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600"
                      title="Editar"
                      aria-label={`Editar fila ${q.name}`}
                    >
                      <Icons.Settings className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDeleteCandidate(q); setSubmitError(''); }}
                      className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                      title="Excluir"
                      aria-label={`Excluir fila ${q.name}`}
                    >
                      ×
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
                  <QueueStatusBadge queue={q} label={q.isActive ? 'Ativo no menu' : 'Inativo'} className="uppercase tracking-widest" />
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
      {confirmRestore && (
        <Dialog title="Restaurar menu padrão" description="As 6 filas padrão do supermercado serão criadas ou reativadas com o nome, cor e SLA originais. Filas que você personalizou continuam como estão." onClose={() => { if (!restoring) setConfirmRestore(false); }}>
          <div className="p-6"><p className="text-sm text-slate-600 dark:text-slate-300">Use isso se quiser trazer de volta uma opção padrão que foi removida ou desativada.</p><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={restoring} onClick={() => setConfirmRestore(false)} className="mavo-button-secondary">Cancelar</button><button type="button" disabled={restoring} onClick={() => void restoreDefaultMenu()} className="mavo-button-primary">{restoring ? 'Restaurando...' : 'Restaurar menu padrão'}</button></div></div>
        </Dialog>
      )}
      {deleteCandidate && (
        <Dialog title="Excluir fila" description={`A fila “${deleteCandidate.name}” só será removida se não houver atendimentos vinculados. O histórico nunca será apagado.`} onClose={() => { if (!deleting) setDeleteCandidate(null); }}>
          <div className="p-6"><p className="text-sm text-slate-600 dark:text-slate-300">Caso a fila esteja em uso, desative-a ou transfira os atendimentos antes de tentar excluí-la.</p>{submitError && <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-300">{submitError}</p>}<div className="mt-5 flex justify-end gap-3"><button type="button" disabled={deleting} onClick={() => setDeleteCandidate(null)} className="mavo-button-secondary">Cancelar</button><button type="button" disabled={deleting} onClick={() => void removeQueue()} className="mavo-button-danger">{deleting ? 'Excluindo...' : 'Excluir fila'}</button></div></div>
        </Dialog>
      )}
    </div></main>
  );
};

export default TicketTypeManagement;
