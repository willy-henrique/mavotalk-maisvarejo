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
    <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-800/95">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Indicadores do negócio</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Vendas, produtos e estoque sincronizados pelo agente.</p>
        </div>
        <label className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          Período
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="ml-3 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
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

      {error && <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>}
      {loading ? (
        <div className="py-20 text-center text-slate-500">Carregando indicadores...</div>
      ) : !data?.summary.totals.hasData ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 p-12 text-center text-slate-500">
          Ainda não há dados sincronizados para este período.
          {data?.freshness.lastSourceUpdate && (
            <div className="mt-2 text-sm">Última atualização: {new Date(data.freshness.lastSourceUpdate).toLocaleString('pt-BR')}</div>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {[
              ['Total vendido', currency.format(data.summary.totals.netTotal)],
              ['Quantidade de vendas', number.format(data.summary.totals.salesCount)],
              ['Ticket médio', currency.format(data.summary.averageTicket)],
              ['Média diária', currency.format(data.summary.averagePerDay)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-black text-slate-800 dark:text-slate-100">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-5">
              <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-4">Evolução por dia</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[...data.salesByDay].reverse()}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(value) => `R$ ${Math.round(value / 1000)}k`} />
                    <Tooltip formatter={(value) => currency.format(Number(value))} />
                    <Line type="monotone" dataKey="netTotal" name="Vendas" stroke="#2563eb" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-5">
              <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-4">Vendas por dia da semana</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.salesByWeekday}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="weekdayName" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(value) => `R$ ${Math.round(value / 1000)}k`} />
                    <Tooltip formatter={(value) => currency.format(Number(value))} />
                    <Bar dataKey="netTotal" name="Vendas" fill="#10b981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-5">
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
            <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-5">
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

      <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-5">
        <h2 className="font-bold text-slate-800 dark:text-slate-100">Pergunte sobre o negócio</h2>
        <form onSubmit={ask} className="mt-3 flex flex-col sm:flex-row gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={500}
            placeholder="Ex.: Compare este mês com o período anterior"
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 px-4 py-3"
          />
          <button disabled={querying} className="rounded-lg bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50">
            {querying ? 'Consultando...' : 'Consultar'}
          </button>
        </form>
        {queryReply && <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 dark:bg-slate-950 p-4 text-sm text-slate-700 dark:text-slate-200">{queryReply}</pre>}
      </section>
    </div>
  );
};

export default BusinessAnalytics;
