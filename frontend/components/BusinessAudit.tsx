import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    apiGet<{ items: AuditItem[]; total: number }>(
      `/api/business/audit?page=${page}&pageSize=${pageSize}`,
    )
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
        setError('');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar auditoria'))
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-800/95">
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Auditoria gerencial</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">Consultas pela UI, WhatsApp e MCP. Valores financeiros completos não são armazenados neste log.</p>
      {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>}
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
                  <td className="p-4">{item.status}{item.errorCode ? ` (${item.errorCode})` : ''}</td>
                  <td className="p-4">{item.durationMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
          <span>
            Página {page} de {Math.ceil(total / pageSize)} — {total} eventos
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => {
                setLoading(true);
                setPage((value) => Math.max(1, value - 1));
              }}
              className="rounded-lg border px-3 py-2 disabled:opacity-40 dark:border-slate-700"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page * pageSize >= total}
              onClick={() => {
                setLoading(true);
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
