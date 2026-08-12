import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiDelete, apiFetch, apiGet, apiPost, apiPatch } from '../../services/api';
import { Icons } from '../../constants';
import { Dialog } from '../ui/Dialog';
import { EmptyState, ErrorState, LoadingState } from '../ui/PageState';
import { StatusBadge } from '../ui/StatusBadge';
import { QueueAutomationDrawer, type QueueAutomationTab } from './QueueAutomationDrawer';

type Queue = {
  id: string;
  name: string;
  menuOption: number;
  colorHex: string;
  defaultSlaMins: number;
  isActive: boolean;
  isSystem?: boolean;
  queueType?: 'custom' | 'offers_promotions' | 'business_hours_location';
};

type StoreSettings = {
  enabled: boolean;
  aiFallbackEnabled: boolean;
  agentSignatureEnabled: boolean;
  invalidOptionMessage: string | null;
  botName: string;
  storeName: string;
  address: string | null;
  mapsUrl: string | null;
  offersUrl: string | null;
  offersText: string | null;
  offersImageUrl: string | null;
  phone: string | null;
};

/**
 * Menor posição livre entre 1 e 99. Somar 1 ao maior número em uso quebrava em
 * bases migradas, onde uma fila legada ficou em 103 e o limite do schema é 99.
 */
const nextFreeMenuOption = (queues: Queue[]): number => {
  const used = new Set(queues.map((queue) => queue.menuOption));
  for (let option = 1; option <= 99; option += 1) if (!used.has(option)) return option;
  return 99;
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
  const [formQueueType, setFormQueueType] = useState<NonNullable<Queue['queueType']>>('custom');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Queue | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [configuringQueue, setConfiguringQueue] = useState<{ queue: Queue; tab: QueueAutomationTab } | null>(null);
  const requestRef = useRef(0);

  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeError, setStoreError] = useState('');

  const [identityBotName, setIdentityBotName] = useState('');
  const [identityStoreName, setIdentityStoreName] = useState('');
  const [identityEnabled, setIdentityEnabled] = useState(true);
  const [identityAiFallback, setIdentityAiFallback] = useState(false);
  const [identitySignature, setIdentitySignature] = useState(true);
  const [identityInvalidOption, setIdentityInvalidOption] = useState('');
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityError, setIdentityError] = useState('');
  const [identityNotice, setIdentityNotice] = useState('');
  const [storeNameConfigured, setStoreNameConfigured] = useState(true);

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

  const fetchStoreSettings = useCallback(async () => {
    setStoreLoading(true);
    setStoreError('');
    try {
      const data = await apiGet<{ settings: StoreSettings; storeNameConfigured?: boolean }>('/api/admin/supermarket-settings');
      setStoreSettings(data.settings);
      setStoreNameConfigured(data.storeNameConfigured !== false);
      setIdentityBotName(data.settings.botName);
      setIdentityStoreName(data.settings.storeName);
      setIdentityEnabled(data.settings.enabled);
      setIdentityAiFallback(data.settings.aiFallbackEnabled);
      setIdentitySignature(data.settings.agentSignatureEnabled !== false);
      setIdentityInvalidOption(data.settings.invalidOptionMessage || '');
    } catch (error) {
      setStoreError(error instanceof Error ? error.message : 'Não foi possível carregar as configurações da loja.');
    } finally {
      setStoreLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueues();
    fetchStoreSettings();
  }, [fetchQueues, fetchStoreSettings]);

  const saveIdentity = async (event: React.FormEvent) => {
    event.preventDefault();
    const botName = identityBotName.trim();
    const storeName = identityStoreName.trim();
    if (!botName || !storeName) {
      setIdentityError('Informe o nome do assistente e o nome da loja.');
      return;
    }
    setIdentitySaving(true);
    setIdentityError('');
    setIdentityNotice('');
    try {
      const result = await apiPatch<{ settings: StoreSettings }>('/api/admin/supermarket-settings', {
        botName,
        storeName,
        enabled: identityEnabled,
        aiFallbackEnabled: identityAiFallback,
        agentSignatureEnabled: identitySignature,
        invalidOptionMessage: identityInvalidOption.trim() || null,
      });
      setStoreSettings(result.settings);
      setStoreNameConfigured(true);
      setIdentityNotice(`Pronto: o bot passa a se apresentar como assistente do ${storeName}.`);
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      setIdentitySaving(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setFormName('');
    setFormMenuOption(nextFreeMenuOption(queues));
    setFormColorHex('#64748b');
    setFormDefaultSlaMins(30);
    setFormIsActive(true);
    setFormQueueType('custom');
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
    setFormQueueType(q.queueType || 'custom');
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
        queueType: formQueueType,
      };
      if (editingId) {
        await apiPatch(`/api/queues/${editingId}`, body);
      } else {
        await apiPost<{ queue: Queue }>('/api/queues', body);
      }
      await fetchQueues();
      setNotice(editingId ? 'Dados básicos da fila atualizados.' : 'Fila criada. Agora configure a automação antes de disponibilizá-la ao cliente.');
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
  const openAutomation = (queue: Queue, tab: QueueAutomationTab = 'Visão geral') => setConfiguringQueue({ queue, tab });

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
            Criar nova fila
          </button>
        </div>
      </div>

      <section className="mavo-card mb-8 p-5">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome do supermercado e identidade do bot</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Usados em toda mensagem do bot no WhatsApp. Endereço, horários e ofertas ficam dentro de cada fila correspondente, abaixo.</p>
        {!storeLoading && !storeError && !storeNameConfigured && (
          <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            O nome do supermercado ainda não foi configurado: o bot está se apresentando com o rótulo padrão <strong>“{storeSettings?.storeName}”</strong> para os clientes. Escreva o nome real abaixo e salve.
          </p>
        )}
        {storeLoading ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Carregando…</p>
        ) : storeError ? (
          <ErrorState className="mt-4" description={storeError} action={<button type="button" onClick={() => void fetchStoreSettings()} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />
        ) : (
          <form onSubmit={saveIdentity} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="identity-store-name" className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome do supermercado</label>
                <input id="identity-store-name" type="text" value={identityStoreName} onChange={(e) => setIdentityStoreName(e.target.value)} maxLength={160} placeholder="Ex.: Supermercado Bom Preço" className="mavo-field" required />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Aparece em toda mensagem: “assistente virtual do {identityStoreName.trim() || '…'}”.</p>
              </div>
              <div>
                <label htmlFor="identity-bot-name" className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome do assistente</label>
                <input id="identity-bot-name" type="text" value={identityBotName} onChange={(e) => setIdentityBotName(e.target.value)} maxLength={80} className="mavo-field" required />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Como o robô se chama ao falar com o cliente.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="flex min-w-56 flex-1 items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Bot ativo</p>
                <button type="button" role="switch" aria-checked={identityEnabled} aria-label="Alternar bot ativo" onClick={() => setIdentityEnabled((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${identityEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}><span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${identityEnabled ? 'translate-x-6' : 'translate-x-1'}`} /></button>
              </div>
              <div className="flex min-w-56 flex-1 items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Usar IA para mensagens não reconhecidas</p>
                <button type="button" role="switch" aria-checked={identityAiFallback} aria-label="Alternar fallback de IA" onClick={() => setIdentityAiFallback((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${identityAiFallback ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}><span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${identityAiFallback ? 'translate-x-6' : 'translate-x-1'}`} /></button>
              </div>
              <div className="flex min-w-56 flex-1 items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Assinar mensagens com o nome do atendente</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{identitySignature ? 'O cliente recebe "Atendente:" antes do texto.' : 'O cliente recebe apenas o texto digitado.'}</p>
                </div>
                <button type="button" role="switch" aria-checked={identitySignature} aria-label="Alternar assinatura do atendente" onClick={() => setIdentitySignature((v) => !v)} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${identitySignature ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}><span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${identitySignature ? 'translate-x-6' : 'translate-x-1'}`} /></button>
              </div>
              <div className="min-w-56 flex-1 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <label htmlFor="invalid-option-message" className="block text-sm font-bold text-slate-800 dark:text-slate-100">
                  Mensagem quando a opção não existe
                </label>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Enviada antes do menu quando o cliente digita algo fora da lista. Em branco usa o texto padrão.
                </p>
                <textarea
                  id="invalid-option-message"
                  rows={2}
                  maxLength={500}
                  value={identityInvalidOption}
                  onChange={(event) => setIdentityInvalidOption(event.target.value)}
                  placeholder="Não encontrei essa opção. Escolha um dos números da lista abaixo:"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            {identityError && <p className="text-sm text-rose-600">{identityError}</p>}
            {identityNotice && <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{identityNotice}</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={identitySaving} className="mavo-button-primary">{identitySaving ? 'Salvando...' : 'Salvar nome do supermercado'}</button>
            </div>
          </form>
        )}
      </section>

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
            <tbody>{filteredQueues.map((queue) => <tr key={queue.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/80 dark:hover:bg-slate-800/50"><td className="px-4 py-3"><span className="mr-3 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: queue.colorHex }} aria-hidden="true" /><span className="font-medium text-slate-800 dark:text-slate-200">{queue.name}</span></td><td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{queue.menuOption}</td><td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{queue.defaultSlaMins} min</td><td className="px-4 py-3"><QueueStatusBadge queue={queue} /></td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><button type="button" onClick={() => openAutomation(queue)} className="mavo-button-primary min-h-0 px-3 py-2 text-xs">Configurar</button><button type="button" onClick={() => openAutomation(queue, 'Prévia')} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Testar</button><button type="button" onClick={() => openEdit(queue)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Editar dados</button><button type="button" onClick={() => { setDeleteCandidate(queue); setSubmitError(''); }} className="mavo-button-danger min-h-0 px-3 py-2 text-xs">Excluir</button></div></td></tr>)}</tbody>
          </table>
        </div><div className="grid gap-3 md:hidden">{filteredQueues.map((queue) => <article key={queue.id} className="mavo-card space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: queue.colorHex }} aria-hidden="true" /><h3 className="truncate font-bold text-slate-800 dark:text-slate-100">{queue.name}</h3></div><QueueStatusBadge queue={queue} className="shrink-0" /></div><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="font-semibold text-slate-500">Opção no menu</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{queue.menuOption}</dd></div><div><dt className="font-semibold text-slate-500">SLA</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{queue.defaultSlaMins} min</dd></div></dl><div className="flex flex-wrap gap-2"><button type="button" onClick={() => openAutomation(queue)} className="mavo-button-primary min-h-0 px-3 py-2 text-xs">Configurar</button><button type="button" onClick={() => openAutomation(queue, 'Prévia')} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Testar</button><button type="button" onClick={() => openEdit(queue)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Editar dados</button><button type="button" onClick={() => { setDeleteCandidate(queue); setSubmitError(''); }} className="mavo-button-danger min-h-0 px-3 py-2 text-xs">Excluir</button></div></article>)}</div></>
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
                      onClick={() => openAutomation(q)}
                      className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600"
                      title="Configurar automação"
                      aria-label={`Configurar automação da fila ${q.name}`}
                    >
                      <Icons.Settings className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(q)}
                      className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600"
                      title="Editar dados básicos"
                      aria-label={`Editar dados básicos da fila ${q.name}`}
                    >
                      ✎
                    </button>
                    {!q.isSystem && <button
                      type="button"
                      onClick={() => { setDeleteCandidate(q); setSubmitError(''); }}
                      className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                      title="Excluir"
                      aria-label={`Excluir fila ${q.name}`}
                    >
                      ×
                    </button>}
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
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-400 uppercase tracking-widest">Automação</span>
                    {/* O comportamento vem do tipo da fila, nunca da posição: mover
                        "Ofertas" para outro número não muda o que o cliente recebe. */}
                    <span className="text-slate-700 dark:text-slate-200">{q.queueType === 'offers_promotions' ? 'Ofertas' : q.queueType === 'business_hours_location' ? 'Horários' : 'Personalizada'}</span>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between">
                  <QueueStatusBadge queue={q} label={q.isActive ? 'Ativo no menu' : 'Inativo'} className="uppercase tracking-widest" />
                  <div className="flex gap-2"><button type="button" onClick={() => openAutomation(q)} className="mavo-button-primary min-h-0 px-3 py-2 text-xs">Configurar</button><button type="button" onClick={() => openAutomation(q, 'Prévia')} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Testar</button></div>
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
              <div>
                <label htmlFor="queue-type" className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo da fila</label>
                <select id="queue-type" value={formQueueType} onChange={(e) => setFormQueueType(e.target.value as typeof formQueueType)} className="mavo-field">
                  <option value="custom">Fila personalizada</option>
                  <option value="offers_promotions">Ofertas e promoções</option>
                  <option value="business_hours_location">Horários e localização</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div><p className="text-sm font-bold text-slate-800 dark:text-slate-100">Ativo no menu do chatbot</p><p className="text-xs text-slate-500 dark:text-slate-400">Filas inativas não aparecem como opção para o cliente.</p></div>
                <button type="button" role="switch" aria-checked={formIsActive} aria-label="Alternar fila ativa no menu do chatbot" onClick={() => setFormIsActive((value) => !value)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${formIsActive ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}><span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${formIsActive ? 'translate-x-6' : 'translate-x-1'}`} /></button>
              </div>

              {editingId && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-100">
                  O conteúdo e as mensagens do cliente são configurados separadamente, em etapas, pelo botão <strong>Configurar automação</strong>. Assim, salvar estes dados básicos não publica nada por engano.
                </div>
              )}

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
      {configuringQueue && <QueueAutomationDrawer key={`${configuringQueue.queue.id}-${configuringQueue.tab}`} queue={configuringQueue.queue} initialTab={configuringQueue.tab} onClose={() => setConfiguringQueue(null)} onChanged={() => { void fetchQueues(); }} />}
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
