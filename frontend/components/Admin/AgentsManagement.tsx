import React, { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../services/api';

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
    if (!window.confirm(`Revogar o agente ${agent.name}?`)) return;
    setAction(`revoke:${agent.id}`);
    setError('');
    try {
      await apiPost(`/api/admin/agents/${agent.id}/revoke`, {});
      await load();
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

  const statusClass = (agent: Agent) => {
    if (agent.revokedAt) return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    if (agent.lastBatchError) return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
    if (agent.status.toLowerCase() === 'active' || agent.status.toLowerCase() === 'online') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
  };

  return (
    <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-800/95">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Agentes de sincronização</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Comunicação de saída do ambiente do cliente para a nuvem.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || action !== null} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
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
          <button type="button" onClick={() => void copyCredential()} className="mt-3 rounded-lg bg-amber-900 px-3 py-2 text-sm font-bold text-white">Copiar</button>
          <button onClick={() => setCredential(null)} className="mt-3 ml-2 rounded-lg border border-amber-400 px-3 py-2 text-sm font-bold">Já salvei</button>
          {credentialNotice && <p className="mt-3 text-sm font-medium" role="status">{credentialNotice}</p>}
        </div>
      )}
      <form onSubmit={provision} className="mb-6 flex flex-col sm:flex-row gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={200} placeholder="Nome da instalação" className="flex-1 rounded-lg border p-3 dark:bg-slate-950 dark:border-slate-700" />
        <button disabled={action !== null} className="rounded-lg bg-blue-600 px-5 py-3 font-bold text-white disabled:cursor-wait disabled:opacity-60">{action === 'provision' ? 'Provisionando...' : 'Provisionar agente'}</button>
      </form>
      {loading ? (
        <div className="py-12 text-slate-500">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500">Nenhum agente provisionado.</div>
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
                    <button type="button" disabled={Boolean(item.revokedAt) || action !== null} onClick={() => void rotate(item)} className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800 disabled:opacity-40">{action === `rotate:${item.id}` ? 'Rotacionando...' : 'Rotacionar'}</button>
                    <button type="button" disabled={Boolean(item.revokedAt) || action !== null} onClick={() => void revoke(item)} className="rounded bg-rose-100 px-2 py-1 text-rose-700 disabled:opacity-40 dark:bg-rose-950/40 dark:text-rose-300">{action === `revoke:${item.id}` ? 'Revogando...' : 'Revogar'}</button>
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
    </div>
  );
};

export default AgentsManagement;
