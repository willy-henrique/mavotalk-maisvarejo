import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, apiGet } from '../services/api';
import { Dialog } from './ui/Dialog';

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
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [sort, setSort] = useState('recent');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ query: '', status: '', origin: '', sort: 'recent', from: '', to: '' });
  const [selected, setSelected] = useState<AuditItem | null>(null);
  const [detail, setDetail] = useState<{ sanitizedInput: string | null; parameters: Record<string, unknown>; resultSummary: Record<string, unknown> } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      for (const [key, value] of Object.entries(appliedFilters)) if (value) params.set(key, value);
      const data = await apiGet<{ items: AuditItem[]; total: number }>(`/api/business/audit?${params}`);
      setItems(data.items);
      setTotal(data.total);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar auditoria');
    } finally {
      setLoading(false);
    }
  }, [page, appliedFilters]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasAppliedFilters = Boolean(appliedFilters.query || appliedFilters.status || appliedFilters.origin || appliedFilters.from || appliedFilters.to || appliedFilters.sort !== 'recent');
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

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ query: query.trim(), status: statusFilter, origin: originFilter, sort, from, to });
  };

  const clearFilters = () => {
    setQuery(''); setStatusFilter(''); setOriginFilter(''); setFrom(''); setTo('');
    setSort('recent');
    setPage(1); setAppliedFilters({ query: '', status: '', origin: '', sort: 'recent', from: '', to: '' });
  };

  const openDetail = async (item: AuditItem) => {
    setSelected(item); setDetail(null); setLoadingDetail(true);
    try {
      const result = await apiGet<{ item: typeof detail }>(`/api/business/audit/${item.id}`);
      setDetail(result.item);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o evento de auditoria');
    } finally {
      setLoadingDetail(false);
    }
  };

  const exportAudit = async () => {
    setExporting(true);
    setError('');
    try {
      const params = new URLSearchParams({ format: 'csv' });
      for (const [key, value] of Object.entries(appliedFilters)) if (value) params.set(key, value);
      const response = await apiFetch(`/api/business/audit?${params.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'Não foi possível exportar a auditoria.');
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'auditoria-mavo-talk.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível exportar a auditoria.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="mavo-page">
      <div className="mavo-page-content">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Auditoria gerencial</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Consultas pela UI, WhatsApp e MCP. Valores financeiros completos não são armazenados neste log.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void exportAudit()} disabled={exporting || loading} className="mavo-button-secondary">
            {exporting ? 'Exportando...' : 'Exportar CSV'}
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="mavo-button-secondary">
            {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>
      <form onSubmit={applyFilters} className="mavo-card mb-5 grid gap-3 p-4 md:grid-cols-7">
        <label className="md:col-span-2"><span className="sr-only">Buscar auditoria</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="mavo-field" placeholder="Buscar consulta, origem ou pessoa" /></label>
        <label><span className="sr-only">Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mavo-field"><option value="">Todos os estados</option><option value="success">Sucesso</option><option value="empty">Sem resultado</option><option value="denied">Negado</option><option value="failed">Falha</option></select></label>
        <label><span className="sr-only">Origem</span><select value={originFilter} onChange={(event) => setOriginFilter(event.target.value)} className="mavo-field"><option value="">Todas as origens</option><option value="ui">Painel</option><option value="whatsapp">WhatsApp</option><option value="mcp">MCP</option></select></label>
        <label><span className="sr-only">Ordenação</span><select aria-label="Ordenação" value={sort} onChange={(event) => setSort(event.target.value)} className="mavo-field"><option value="recent">Mais recentes</option><option value="oldest">Mais antigos</option><option value="duration_desc">Maior duração</option><option value="duration_asc">Menor duração</option></select></label>
        <label><span className="sr-only">Data inicial</span><input aria-label="Data inicial" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mavo-field" /></label>
        <div className="flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Data final</span><input aria-label="Data final" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mavo-field" /></label><button className="mavo-button-primary px-3" type="submit">Filtrar</button>{hasAppliedFilters && <button className="mavo-button-secondary px-3" type="button" onClick={clearFilters}>Limpar</button>}</div>
      </form>
      {error && <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"><span>{error}</span><button type="button" onClick={() => void load()} className="font-bold underline">Tentar novamente</button></div>}
      {loading ? (
        <div className="py-12 text-slate-500">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="mavo-card p-10 text-center text-slate-500 dark:text-slate-400">Nenhuma consulta encontrada com os filtros atuais.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase text-slate-500"><tr><th className="p-4">Quando</th><th className="p-4">Quem</th><th className="p-4">Origem</th><th className="p-4">Consulta</th><th className="p-4">Estado</th><th className="p-4">Duração</th><th className="p-4"><span className="sr-only">Detalhes</span></th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-4">{new Date(item.createdAt).toLocaleString('pt-BR')}</td>
                  <td className="p-4">{item.actorName || item.phoneNormalized || 'Sistema'}</td>
                  <td className="p-4 uppercase">{item.origin}</td>
                  <td className="p-4">{item.queryType}</td>
                  <td className="p-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(item.status)}`}>{item.status}{item.errorCode ? ` · ${item.errorCode}` : ''}</span></td>
                  <td className="p-4">{item.durationMs} ms</td>
                  <td className="p-4"><button type="button" className="rounded-lg px-2 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30" onClick={() => void openDetail(item)}>Ver detalhe</button></td>
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
      {selected && <Dialog title="Detalhe de auditoria" description={`${selected.queryType} · ${new Date(selected.createdAt).toLocaleString('pt-BR')}`} onClose={() => setSelected(null)}><div className="space-y-4 p-6 text-sm"><dl className="grid grid-cols-2 gap-3"><div><dt className="text-xs font-bold uppercase text-slate-500">Origem</dt><dd className="mt-1 text-slate-900 dark:text-white">{selected.origin}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-500">Duração</dt><dd className="mt-1 text-slate-900 dark:text-white">{selected.durationMs} ms</dd></div><div><dt className="text-xs font-bold uppercase text-slate-500">Estado</dt><dd className="mt-1 text-slate-900 dark:text-white">{selected.status}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-500">Responsável</dt><dd className="mt-1 text-slate-900 dark:text-white">{selected.actorName || 'Sistema'}</dd></div></dl>{loadingDetail ? <p className="text-slate-500">Carregando dados mascarados…</p> : detail && <><div><h3 className="text-xs font-bold uppercase text-slate-500">Entrada sanitizada</h3><p className="mt-1 rounded-lg bg-slate-100 p-3 text-slate-700 dark:bg-slate-950 dark:text-slate-200">{detail.sanitizedInput || 'Não registrada'}</p></div><div><h3 className="text-xs font-bold uppercase text-slate-500">Parâmetros</h3><pre className="mt-1 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-200">{JSON.stringify(detail.parameters, null, 2)}</pre></div><div><h3 className="text-xs font-bold uppercase text-slate-500">Resumo</h3><pre className="mt-1 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-200">{JSON.stringify(detail.resultSummary, null, 2)}</pre></div></>}</div></Dialog>}
      </div>
    </main>
  );
};

export default BusinessAudit;
