import React, { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../services/api';
import { Dialog } from '../ui/Dialog';
import { EmptyState, ErrorState, LoadingState } from '../ui/PageState';
import { Pagination } from '../ui/Pagination';
import { StatusBadge, type StatusTone } from '../ui/StatusBadge';

type Agent = {
  id: string;
  name: string;
  installationKey: string;
  status: string;
  agentVersion: string | null;
  schemaVersion: string | null;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  lastBatchError: string | null;
  receivedRecords: number;
  revokedAt: string | null;
};

type Credential = { agentId: string; secret: string; keyVersion: number; agent: Agent };
type AgentEvent = { id: string; eventType: string; status: 'success' | 'rejected' | 'failed'; errorCode: string | null; durationMs: number | null; createdAt: string };

const agentStatusTone = (agent: Agent): StatusTone => {
  if (agent.revokedAt) return 'neutral';
  if (agent.lastBatchError) return 'error';
  if (agent.status.toLowerCase() === 'active' || agent.status.toLowerCase() === 'online') return 'success';
  return 'warning';
};

const AgentStatusBadge: React.FC<{ agent: Agent; className?: string }> = ({ agent, className = '' }) => (
  <StatusBadge tone={agentStatusTone(agent)} className={className}>{agent.revokedAt ? 'Revogado' : agent.status}</StatusBadge>
);

const AgentsManagement: React.FC = () => {
  const [items, setItems] = useState<Agent[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [credential, setCredential] = useState<Credential | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [credentialNotice, setCredentialNotice] = useState('');
  const [revokeCandidate, setRevokeCandidate] = useState<Agent | null>(null);
  const [eventsFor, setEventsFor] = useState<Agent | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const pageSize = 25;
  const deferredSearch = useDeferredValue(search);
  const loadRequestRef = useRef(0);
  const eventsRequestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++loadRequestRef.current;
    setLoading(true);
    try {
      const data = await apiGet<{ items: Agent[]; total: number }>(
        `/api/admin/agents?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(deferredSearch)}&status=${encodeURIComponent(statusFilter)}`,
      );
      if (request !== loadRequestRef.current) return;
      setItems(data.items);
      setTotal(data.total);
      setError('');
    } catch (reason) {
      if (request !== loadRequestRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar agentes');
    } finally {
      if (request === loadRequestRef.current) setLoading(false);
    }
  }, [page, deferredSearch, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, statusFilter]);

  const provision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setAction('provision');
    setError('');
    try {
      const created = await apiPost<Credential>('/api/admin/agents/provision', { name: newName.trim() });
      setCredential(created);
      setCredentialNotice('');
      setNewName('');
      if (page === 1) await load();
      else setPage(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Provisionamento não concluído');
    } finally {
      setAction(null);
    }
  };

  const revoke = async (agent: Agent) => {
    setAction(`revoke:${agent.id}`);
    setError('');
    try {
      await apiPost(`/api/admin/agents/${agent.id}/revoke`, {});
      await load();
      setRevokeCandidate(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Revogação não concluída');
    } finally {
      setAction(null);
    }
  };

  const rotate = async (agent: Agent) => {
    setAction(`rotate:${agent.id}`);
    setError('');
    try {
      const rotated = await apiPost<Credential>(`/api/admin/agents/${agent.id}/rotate-credential`, {});
      setCredential(rotated);
      setCredentialNotice('');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rotação não concluída');
    } finally {
      setAction(null);
    }
  };

  const copyCredential = async () => {
    if (!credential) return;
    setCredentialNotice('');
    try {
      await navigator.clipboard.writeText(`MAVO_SIM_AGENT_ID=${credential.agentId}\nMAVO_SIM_AGENT_SECRET=${credential.secret}`);
      setCredentialNotice('Credencial copiada. Guarde-a em um local seguro.');
    } catch {
      setCredentialNotice('Não foi possível copiar automaticamente. Selecione e copie os dados acima manualmente.');
    }
  };

  const openEvents = async (agent: Agent) => {
    const request = ++eventsRequestRef.current;
    setEventsFor(agent);
    setEvents([]);
    setLoadingEvents(true);
    try {
      const result = await apiGet<{ items: AgentEvent[] }>(`/api/admin/agents/${agent.id}/events`);
      if (request !== eventsRequestRef.current) return;
      setEvents(result.items);
    } catch (reason) {
      if (request !== eventsRequestRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os logs do agente');
    } finally {
      if (request === eventsRequestRef.current) setLoadingEvents(false);
    }
  };

  const closeEvents = () => {
    eventsRequestRef.current += 1;
    setEventsFor(null);
    setEvents([]);
  };

  const recommendedAction = (agent: Agent) => {
    if (agent.revokedAt) return 'Provisionar uma nova instalação';
    if (agent.lastBatchError) return 'Abrir logs e corrigir a última falha';
    if (agent.status.toLowerCase() !== 'active' && agent.status.toLowerCase() !== 'online') return 'Verificar conexão e heartbeat';
    if (!agent.lastSyncAt) return 'Aguardar ou iniciar a primeira sincronização';
    return 'Nenhuma ação necessária';
  };

  const agentActions = (agent: Agent, compact = false) => <div className={`flex flex-wrap gap-2 ${compact ? '' : 'justify-end'}`}>
    <button type="button" disabled={Boolean(agent.revokedAt) || action !== null} onClick={() => void rotate(agent)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">{action === `rotate:${agent.id}` ? 'Rotacionando...' : 'Rotacionar'}</button>
    <button type="button" disabled={action !== null} onClick={() => void openEvents(agent)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Logs</button>
    <button type="button" disabled={Boolean(agent.revokedAt) || action !== null} onClick={() => setRevokeCandidate(agent)} className="mavo-button-danger min-h-0 px-3 py-2 text-xs">Revogar</button>
  </div>;

  return (
    <main className="mavo-page">
      <div className="mavo-page-content">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Agentes e sincronização</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Provisione instalações, acompanhe sua saúde e investigue eventos de sincronização.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || action !== null} className="mavo-button-secondary">
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>
      {error && <ErrorState className="mb-5" description={error} action={<button type="button" onClick={() => void load()} disabled={loading || action !== null} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}
      <div className="mb-5 flex flex-wrap gap-3">
        <label className="min-w-[15rem] flex-1"><span className="sr-only">Buscar agentes</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou instalação" className="mavo-field" /></label>
        <label><span className="sr-only">Filtrar por estado do agente</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mavo-field"><option value="">Todos os estados</option><option value="online">Online e saudável</option><option value="attention">Requer atenção</option><option value="revoked">Revogado</option></select></label>
      </div>
      {credential && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
          <p className="font-bold">Copie a credencial agora. O segredo não será exibido novamente.</p>
          <div className="mt-3 space-y-2 font-mono text-sm break-all">
            <p>Agent ID: {credential.agentId}</p>
            <p>Secret: {credential.secret}</p>
            <p>Key version: {credential.keyVersion}</p>
          </div>
          <button type="button" onClick={() => void copyCredential()} className="mavo-button-primary mt-3 min-h-0 bg-amber-900 px-3 py-2 text-xs hover:bg-amber-950">Copiar</button>
          <button type="button" onClick={() => setCredential(null)} className="mavo-button-secondary mt-3 ml-2 min-h-0 border-amber-400 px-3 py-2 text-xs">Já salvei</button>
          {credentialNotice && <p className="mt-3 text-sm font-medium" role="status">{credentialNotice}</p>}
        </div>
      )}
      <form onSubmit={provision} className="mavo-card mb-6 flex flex-col gap-3 p-5 sm:flex-row">
        <label className="sr-only" htmlFor="agent-installation-name">Nome da instalação</label>
        <input id="agent-installation-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={200} required placeholder="Nome da instalação" className="mavo-field flex-1" />
        <button disabled={action !== null} className="mavo-button-primary">{action === 'provision' ? 'Provisionando...' : 'Provisionar agente'}</button>
      </form>
      {loading ? (
        <LoadingState title="Carregando agentes e instalações…" />
      ) : items.length === 0 ? (
        <EmptyState title={search || statusFilter ? 'Nenhum agente encontrado.' : 'Nenhum agente provisionado ainda.'} description={search || statusFilter ? 'Altere a busca ou limpe os filtros para visualizar as instalações.' : 'Crie uma instalação para sincronizar dados do ambiente da empresa com segurança.'} action={search || statusFilter ? <button type="button" onClick={() => { setSearch(''); setStatusFilter(''); }} className="mavo-button-secondary">Limpar filtros</button> : undefined} />
      ) : (
        <><div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/80 md:block">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase text-slate-500">
              <tr><th className="p-4">Agente</th><th className="p-4">Status</th><th className="p-4">Versão</th><th className="p-4">Último heartbeat</th><th className="p-4">Última sync</th><th className="p-4">Registros</th><th className="p-4">Ação recomendada</th><th className="p-4">Ações</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-4"><strong className="block">{item.name}</strong><span className="text-xs font-mono text-slate-500">{item.installationKey}</span></td>
                  <td className="p-4"><AgentStatusBadge agent={item} />{item.lastBatchError && <p className="mt-2 max-w-52 text-xs text-rose-600 dark:text-rose-300" title={item.lastBatchError}>Último erro: {item.lastBatchError}</p>}</td>
                  <td className="p-4">{item.agentVersion || '—'} / schema {item.schemaVersion || '—'}</td>
                  <td className="p-4">{item.lastHeartbeatAt ? new Date(item.lastHeartbeatAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td className="p-4">{item.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td className="p-4">{item.receivedRecords}</td>
                  <td className="p-4 text-xs text-slate-600 dark:text-slate-300">{recommendedAction(item)}</td>
                  <td className="p-4">{agentActions(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div><div className="grid gap-3 md:hidden">{items.map((item) => <article key={item.id} className="mavo-card space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-bold text-slate-900 dark:text-white">{item.name}</h3><p className="mt-1 truncate font-mono text-xs text-slate-500">{item.installationKey}</p></div><AgentStatusBadge agent={item} className="shrink-0" /></div><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="font-semibold text-slate-500">Última sync</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{item.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}</dd></div><div><dt className="font-semibold text-slate-500">Registros</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{item.receivedRecords}</dd></div><div className="col-span-2"><dt className="font-semibold text-slate-500">Ação recomendada</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{recommendedAction(item)}</dd></div></dl>{item.lastBatchError && <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">Último erro: {item.lastBatchError}</p>}{agentActions(item, true)}</article>)}</div></>
      )}
      {!loading && <Pagination page={page} pageSize={pageSize} total={total} itemLabel="agentes" onPageChange={setPage} />}
      {eventsFor && (
        <Dialog title={`Logs de ${eventsFor.name}`} description="Eventos recentes da instalação. Endereços de origem não são exibidos nesta tela." onClose={closeEvents}>
          <div className="max-h-[60vh] overflow-auto p-5">
            {loadingEvents ? <p className="text-sm text-slate-500 dark:text-slate-400">Carregando eventos…</p> : events.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum evento de auditoria disponível para este agente.</p> : (
              <ol className="space-y-3">
                {events.map((event) => <li key={event.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="flex items-center justify-between gap-3"><strong className="text-sm text-slate-900 dark:text-white">{event.eventType}</strong><StatusBadge tone={event.status === 'success' ? 'success' : 'error'}>{event.status}</StatusBadge></div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{new Date(event.createdAt).toLocaleString('pt-BR')}{event.durationMs !== null ? ` · ${event.durationMs} ms` : ''}{event.errorCode ? ` · ${event.errorCode}` : ''}</p></li>)}
              </ol>
            )}
          </div>
        </Dialog>
      )}
      {revokeCandidate && (
        <Dialog
          title="Revogar agente"
          description={`A instalação “${revokeCandidate.name}” perderá acesso à sincronização imediatamente. Esta ação pode ser auditada, mas exige novo provisionamento para voltar a operar.`}
          onClose={() => { if (action === null) setRevokeCandidate(null); }}
        >
          <div className="flex justify-end gap-3 p-6">
            <button type="button" disabled={action !== null} onClick={() => setRevokeCandidate(null)} className="mavo-button-secondary">Cancelar</button>
            <button type="button" disabled={action !== null} onClick={() => void revoke(revokeCandidate)} className="mavo-button-danger">{action === `revoke:${revokeCandidate.id}` ? 'Revogando…' : 'Confirmar revogação'}</button>
          </div>
        </Dialog>
      )}
      </div>
    </main>
  );
};

export default AgentsManagement;
