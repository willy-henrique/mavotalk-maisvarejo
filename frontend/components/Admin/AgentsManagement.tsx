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
    try {
      const created = await apiPost<Credential>('/api/admin/agents/provision', { name: newName.trim() });
      setCredential(created);
      setNewName('');
      setPage(1);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Provisionamento não concluído');
    }
  };

  const revoke = async (agent: Agent) => {
    if (!window.confirm(`Revogar o agente ${agent.name}?`)) return;
    setError('');
    try {
      await apiPost(`/api/admin/agents/${agent.id}/revoke`, {});
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Revogação não concluída');
    }
  };

  const rotate = async (agent: Agent) => {
    setError('');
    try {
      const rotated = await apiPost<Credential>(`/api/admin/agents/${agent.id}/rotate-credential`, {});
      setCredential(rotated);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rotação não concluída');
    }
  };

  return (
    <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-800/95">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Agentes de sincronização</h1>
        <p className="text-sm text-slate-500 mt-1">Comunicação de saída do ambiente do cliente para a nuvem.</p>
      </div>
      {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>}
      {credential && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
          <p className="font-bold">Copie a credencial agora. O segredo não será exibido novamente.</p>
          <div className="mt-3 space-y-2 font-mono text-sm break-all">
            <p>Agent ID: {credential.agentId}</p>
            <p>Secret: {credential.secret}</p>
            <p>Key version: {credential.keyVersion}</p>
          </div>
          <button onClick={() => navigator.clipboard.writeText(`MAVO_SIM_AGENT_ID=${credential.agentId}\nMAVO_SIM_AGENT_SECRET=${credential.secret}`)} className="mt-3 rounded-lg bg-amber-900 px-3 py-2 text-sm font-bold text-white">Copiar</button>
          <button onClick={() => setCredential(null)} className="mt-3 ml-2 rounded-lg border border-amber-400 px-3 py-2 text-sm font-bold">Já salvei</button>
        </div>
      )}
      <form onSubmit={provision} className="mb-6 flex flex-col sm:flex-row gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={200} placeholder="Nome da instalação" className="flex-1 rounded-lg border p-3 dark:bg-slate-950 dark:border-slate-700" />
        <button className="rounded-lg bg-blue-600 px-5 py-3 font-bold text-white">Provisionar agente</button>
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
                  <td className="p-4">{item.status}</td>
                  <td className="p-4">{item.agentVersion || '—'} / schema {item.schemaVersion || '—'}</td>
                  <td className="p-4">{item.lastHeartbeatAt ? new Date(item.lastHeartbeatAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td className="p-4">{item.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td className="p-4">{item.receivedRecords}</td>
                  <td className="p-4"><div className="flex gap-2">
                    <button disabled={Boolean(item.revokedAt)} onClick={() => rotate(item)} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 disabled:opacity-40">Rotacionar</button>
                    <button disabled={Boolean(item.revokedAt)} onClick={() => revoke(item)} className="rounded bg-rose-100 text-rose-700 px-2 py-1 disabled:opacity-40">Revogar</button>
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
