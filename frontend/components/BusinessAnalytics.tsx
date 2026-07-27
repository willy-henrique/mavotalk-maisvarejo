import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiGet, apiPost } from '../services/api';
import { EmptyState, ErrorState, LoadingState } from './ui/PageState';

type AnalyticsResponse = {
  period: { from: string; to: string; label: string };
  summary: {
    totals: { netTotal: number; salesCount: number; hasData: boolean };
    averageTicket: number;
    averagePerDay: number;
    topProduct: { productName: string; quantity: number } | null;
    bestWeekday: { weekdayName: string; netTotal: number } | null;
    lastDataUpdate: string | null;
  };
  salesByDay: Array<{ date: string; netTotal: number; salesCount: number }>;
  salesByWeekday: Array<{ weekdayName: string; netTotal: number }>;
  topProducts: Array<{ productId: string; productName: string; quantity: number; netTotal: number | null }>;
  inventory: Array<{ productId: string; productName: string; quantityEntered: number }>;
  freshness: { lastSourceUpdate: string | null; lastAgentSync: string | null; agentStatus: string | null };
};

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const BusinessAnalytics: React.FC = () => {
  const [period, setPeriod] = useState('este mês');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [queryReply, setQueryReply] = useState('');
  const [querying, setQuerying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await apiGet<AnalyticsResponse>(`/api/business/analytics?period=${encodeURIComponent(period)}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setQuerying(true);
    setQueryReply('');
    try {
      const result = await apiPost<{ reply: string }>('/api/business/query', { query: query.trim() });
      setQueryReply(result.reply);
    } catch (reason) {
      setQueryReply(reason instanceof Error ? reason.message : 'Consulta não concluída');
    } finally {
      setQuerying(false);
    }
  };

  return (
    <main className="mavo-page"><div className="mavo-page-content">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Negócio</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Indicadores do negócio</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Vendas, produtos e estoque sincronizados pelo agente. Os indicadores nunca usam dados simulados.</p>
        </div>
        <label htmlFor="business-period" className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          <span className="mb-1 block">Período</span>
          <select
            id="business-period"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="mavo-field min-w-52"
          >
            <option>hoje</option>
            <option>últimos 7 dias</option>
            <option>últimos 15 dias</option>
            <option>últimos 30 dias</option>
            <option>últimos 60 dias</option>
            <option>últimos 90 dias</option>
            <option>este mês</option>
            <option>mês passado</option>
          </select>
        </label>
      </div>

      {error && <ErrorState className="mb-6" title="Não foi possível carregar os indicadores." description={error} action={<button type="button" onClick={() => void load()} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}
      {loading ? (
        <LoadingState title="Carregando indicadores sincronizados…" />
      ) : !data?.summary.totals.hasData ? (
        <EmptyState
          title="Ainda não há dados sincronizados para este período."
          description={<>{'Verifique o agente de sincronização e o período selecionado antes de tomar decisões com estes indicadores.'}{data?.freshness.lastSourceUpdate && <> Última atualização da fonte: {new Date(data.freshness.lastSourceUpdate).toLocaleString('pt-BR')}.</>}</>}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {[
              ['Total vendido', currency.format(data.summary.totals.netTotal)],
              ['Quantidade de vendas', number.format(data.summary.totals.salesCount)],
              ['Ticket médio', currency.format(data.summary.averageTicket)],
              ['Média diária', currency.format(data.summary.averagePerDay)],
            ].map(([label, value]) => (
              <div key={label} className="mavo-card p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-black text-slate-800 dark:text-slate-100">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="mavo-card p-5">
              <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-4">Evolução por dia</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[...data.salesByDay].reverse()}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(value) => `R$ ${Math.round(value / 1000)}k`} />
                    <Tooltip formatter={(value) => currency.format(Number(value))} contentStyle={{ borderRadius: 12, border: '1px solid #475569', backgroundColor: '#0f172a', color: '#e2e8f0' }} />
                    <Line type="monotone" dataKey="netTotal" name="Vendas" stroke="#2563eb" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="mavo-card p-5">
              <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-4">Vendas por dia da semana</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.salesByWeekday}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="weekdayName" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(value) => `R$ ${Math.round(value / 1000)}k`} />
                    <Tooltip formatter={(value) => currency.format(Number(value))} contentStyle={{ borderRadius: 12, border: '1px solid #475569', backgroundColor: '#0f172a', color: '#e2e8f0' }} />
                    <Bar dataKey="netTotal" name="Vendas" fill="#10b981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="mavo-card p-5">
              <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-4">Produtos mais vendidos</h2>
              <div className="space-y-3">
                {data.topProducts.map((item, index) => (
                  <div key={item.productId} className="flex justify-between gap-4 text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{index + 1}. {item.productName}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{number.format(item.quantity)} un.</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="mavo-card p-5">
              <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-4">Entradas de estoque</h2>
              {data.inventory.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma entrada no período.</p>
              ) : (
                <div className="space-y-3">
                  {data.inventory.map((item) => (
                    <div key={item.productId} className="flex justify-between gap-4 text-sm">
                      <span className="text-slate-700 dark:text-slate-200">{item.productName}</span>
                      <span className="font-bold text-slate-900 dark:text-white">{number.format(item.quantityEntered)} un.</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {data && <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400"><span className={`rounded-full px-3 py-1.5 font-bold ${data.freshness.agentStatus === 'online' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-100'}`}>Agente: {data.freshness.agentStatus || 'sem status'}</span><span className="rounded-full bg-slate-100 px-3 py-1.5 dark:bg-slate-800">Fonte: {data.freshness.lastSourceUpdate ? new Date(data.freshness.lastSourceUpdate).toLocaleString('pt-BR') : 'não informada'}</span><span className="rounded-full bg-slate-100 px-3 py-1.5 dark:bg-slate-800">Sincronização: {data.freshness.lastAgentSync ? new Date(data.freshness.lastAgentSync).toLocaleString('pt-BR') : 'não informada'}</span></div>}

      <section className="mavo-card mt-6 p-5">
        <h2 className="font-bold text-slate-800 dark:text-slate-100">Pergunte sobre o negócio</h2>
        <form onSubmit={ask} className="mt-3 flex flex-col sm:flex-row gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={500}
            placeholder="Ex.: Compare este mês com o período anterior"
            className="mavo-field flex-1"
          />
          <button disabled={querying} className="mavo-button-primary">
            {querying ? 'Consultando...' : 'Consultar'}
          </button>
        </form>
        {queryReply && <pre role="status" className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-950 dark:text-slate-200">{queryReply}</pre>}
      </section>
    </div></main>
  );
};

export default BusinessAnalytics;
