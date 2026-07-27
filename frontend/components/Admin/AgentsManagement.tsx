import React, { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../services/api';
import { Dialog } from '../ui/Dialog';

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

const AgentsManagement: React.FC = () => {
  const [items, setItems] = useState<Agent[]>([]);
  const [page, setPage] = useState(1);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items: Agent[]; total: number }>(
        `/api/admin/agents?page=${page}&pageSize=${pageSize}`,
      );
      setItems(data.items);
      setTotal(data.total);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar agentes');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

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
    setEventsFor(agent);
    setEvents([]);
    setLoadingEvents(true);
    try {
      const result = await apiGet<{ items: AgentEvent[] }>(`/api/admin/agents/${agent.id}/events`);
      setEvents(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os logs do agente');
    } finally {
      setLoadingEvents(false);
    }
  };

  const statusClass = (agent: Agent) => {
    if (agent.revokedAt) return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    if (agent.lastBatchError) return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
    if (agent.status.toLowerCase() === 'active' || agent.status.toLowerCase() === 'online') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
  };

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
      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
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
        <div className="py-12 text-slate-500">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="mavo-card p-10 text-center text-slate-500 dark:text-slate-400"><p className="font-bold text-slate-800 dark:text-slate-100">Nenhum agente provisionado ainda.</p><p className="mt-2 text-sm">Crie uma instalação para sincronizar dados do ambiente da empresa com segurança.</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase text-slate-500">
              <tr><th className="p-4">Agente</th><th className="p-4">Status</th><th className="p-4">Versão</th><th className="p-4">Último heartbeat</th><th className="p-4">Última sync</th><th className="p-4">Registros</th><th className="p-4">Ações</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-4"><strong className="block">{item.name}</strong><span className="text-xs font-mono text-slate-500">{item.installationKey}</span></td>
                  <td className="p-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(item)}`}>{item.revokedAt ? 'revogado' : item.status}</span>{item.lastBatchError && <p className="mt-2 max-w-52 text-xs text-rose-600 dark:text-rose-300" title={item.lastBatchError}>Último erro: {item.lastBatchError}</p>}</td>
                  <td className="p-4">{item.agentVersion || '—'} / schema {item.schemaVersion || '—'}</td>
                  <td className="p-4">{item.lastHeartbeatAt ? new Date(item.lastHeartbeatAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td className="p-4">{item.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td className="p-4">{item.receivedRecords}</td>
                  <td className="p-4"><div className="flex gap-2">
                    <button type="button" disabled={Boolean(item.revokedAt) || action !== null} onClick={() => void rotate(item)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">{action === `rotate:${item.id}` ? 'Rotacionando...' : 'Rotacionar'}</button>
                    <button type="button" disabled={action !== null} onClick={() => void openEvents(item)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Logs</button>
                    <button type="button" disabled={Boolean(item.revokedAt) || action !== null} onClick={() => setRevokeCandidate(item)} className="mavo-button-danger min-h-0 px-3 py-2 text-xs">Revogar</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
          <span>
            Página {page} de {Math.ceil(total / pageSize)} — {total} agentes
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="rounded-lg border px-3 py-2 disabled:opacity-40 dark:border-slate-700"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page * pageSize >= total}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-lg border px-3 py-2 disabled:opacity-40 dark:border-slate-700"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
      {eventsFor && (
        <Dialog title={`Logs de ${eventsFor.name}`} description="Eventos recentes da instalação. Endereços de origem não são exibidos nesta tela." onClose={() => setEventsFor(null)}>
          <div className="max-h-[60vh] overflow-auto p-5">
            {loadingEvents ? <p className="text-sm text-slate-500 dark:text-slate-400">Carregando eventos…</p> : events.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum evento de auditoria disponível para este agente.</p> : (
              <ol className="space-y-3">
                {events.map((event) => <li key={event.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="flex items-center justify-between gap-3"><strong className="text-sm text-slate-900 dark:text-white">{event.eventType}</strong><span className={`rounded-full px-2 py-1 text-xs font-bold ${event.status === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'}`}>{event.status}</span></div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{new Date(event.createdAt).toLocaleString('pt-BR')}{event.durationMs !== null ? ` · ${event.durationMs} ms` : ''}{event.errorCode ? ` · ${event.errorCode}` : ''}</p></li>)}
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
