import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../services/api';

type AuditItem = {
  id: string;
  organizationId: string;
  actorName: string | null;
  phoneNormalized: string | null;
  origin: string;
  queryType: string;
  status: string;
  errorCode: string | null;
  durationMs: number;
  createdAt: string;
};

const BusinessAudit: React.FC = () => {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items: AuditItem[]; total: number }>(
        `/api/business/audit?page=${page}&pageSize=${pageSize}`,
      );
      setItems(data.items);
      setTotal(data.total);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar auditoria');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeLabel = useMemo(() => {
    if (!total || !items.length) return 'Nenhum evento';
    const first = (page - 1) * pageSize + 1;
    return `${first}–${first + items.length - 1} de ${total} eventos`;
  }, [items.length, page, total]);

  const statusClass = (status: string) => {
    const normalized = status.toLowerCase();
    if (normalized === 'success' || normalized === 'ok') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
    if (normalized === 'error' || normalized === 'failed') return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
  };

  return (
    <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-800/95">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Auditoria gerencial</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Consultas pela UI, WhatsApp e MCP. Valores financeiros completos não são armazenados neste log.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>
      {error && <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"><span>{error}</span><button type="button" onClick={() => void load()} className="font-bold underline">Tentar novamente</button></div>}
      {loading ? (
        <div className="py-12 text-slate-500">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500">Nenhuma consulta registrada.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase text-slate-500"><tr><th className="p-4">Quando</th><th className="p-4">Tenant</th><th className="p-4">Quem</th><th className="p-4">Origem</th><th className="p-4">Consulta</th><th className="p-4">Estado</th><th className="p-4">Duração</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-4">{new Date(item.createdAt).toLocaleString('pt-BR')}</td>
                  <td className="p-4 font-mono text-xs">{item.organizationId}</td>
                  <td className="p-4">{item.actorName || item.phoneNormalized || 'Sistema'}</td>
                  <td className="p-4 uppercase">{item.origin}</td>
                  <td className="p-4">{item.queryType}</td>
                  <td className="p-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(item.status)}`}>{item.status}{item.errorCode ? ` · ${item.errorCode}` : ''}</span></td>
                  <td className="p-4">{item.durationMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400" aria-live="polite">{rangeLabel}</p>
      {total > pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => {
                setPage((value) => Math.max(1, value - 1));
              }}
              className="rounded-lg border px-3 py-2 disabled:opacity-40 dark:border-slate-700"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => {
                setPage((value) => value + 1);
              }}
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

export default BusinessAudit;
