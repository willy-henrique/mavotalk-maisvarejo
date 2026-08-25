import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiGet } from '../services/api';
import { ErrorState, LoadingState } from './ui/PageState';
import TeamPresence from './TeamPresence';

type SupportMetrics = {
  totalAguardando: number;
  totalAtendimento: number;
  totalEncerrado: number;
  firstResponseAverageMinutes: number | null;
  resolutionAverageMinutes: number | null;
  satisfactionAverage: number | null;
  slaAtRisk: number;
  slaOverdue: number;
  agentsOnline: number;
  lastDataSyncAt: string | null;
  volumeByDemand: Array<{ queueName: string; colorHex: string; total: number }>;
};

const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<SupportMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++loadRequestRef.current;
    setLoading(true);
    try {
      const response = await apiGet<{ metrics: SupportMetrics }>('/api/dashboard/metrics');
      if (request !== loadRequestRef.current) return;
      setMetrics(response.metrics);
      setError('');
    } catch (reason) {
      if (request !== loadRequestRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Métricas indisponíveis.');
    } finally {
      if (request === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cards = metrics ? [
    { label: 'Aguardando', value: metrics.totalAguardando, accent: 'bg-amber-500', hint: 'Conversas que precisam de uma primeira ação' },
    { label: 'Em atendimento', value: metrics.totalAtendimento, accent: 'bg-blue-500', hint: 'Conversas em andamento pela equipe' },
    { label: 'Resolvidos', value: metrics.totalEncerrado, accent: 'bg-emerald-500', hint: 'Conversas encerradas no período' },
    { label: '1ª resposta', value: metrics.firstResponseAverageMinutes == null ? '—' : `${metrics.firstResponseAverageMinutes} min`, accent: 'bg-violet-500', hint: 'Média até o primeiro retorno' },
    { label: 'SLA próximo', value: metrics.slaAtRisk, accent: 'bg-amber-500', hint: 'Primeiras respostas nos próximos 15 min' },
    { label: 'SLA vencido', value: metrics.slaOverdue, accent: 'bg-rose-500', hint: 'Tickets sem primeira resposta no prazo' },
    { label: 'Resolução', value: metrics.resolutionAverageMinutes == null ? '—' : `${metrics.resolutionAverageMinutes} min`, accent: 'bg-cyan-500', hint: 'Média até o encerramento' },
    { label: 'Sync online', value: metrics.agentsOnline, accent: 'bg-emerald-500', hint: 'Agentes de sincronização com heartbeat nos últimos 5 min — não são atendentes' },
  ] : [];

  return (
    <main className="mavo-page"><div className="mavo-page-content">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm text-slate-500 dark:text-slate-400">Acompanhe o ritmo da operação e distribua a atenção onde ela é necessária.</p></div>
        <div className="flex items-center gap-3"><p className="text-xs text-slate-500 dark:text-slate-400">Dados de sync: {metrics?.lastDataSyncAt ? new Date(metrics.lastDataSyncAt).toLocaleString('pt-BR') : 'ainda indisponíveis'}</p><button type="button" onClick={() => void load()} disabled={loading} className="mavo-button-secondary">{loading ? 'Atualizando...' : 'Atualizar dados'}</button></div>
      </div>

      {error && <ErrorState className="mb-6" title="Não foi possível carregar os indicadores." description={error} action={<button type="button" onClick={() => void load()} disabled={loading} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}

      {loading && !metrics ? <LoadingState title="Carregando indicadores operacionais…" description="Validando o estado atual das filas, SLAs e agentes." /> : metrics && <><section aria-busy={loading} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <article key={card.label} className="mavo-card group p-5 transition hover:-translate-y-0.5 hover:shadow-lg"><div className={`mb-5 h-2 w-12 rounded-full ${card.accent}`} /><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">{card.label}</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{card.value}</p><p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{card.hint}</p></article>)}</section><section className="mavo-card mt-6 p-5 sm:p-6"><div className="mb-6 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-black text-slate-900 dark:text-white">Distribuição por fila</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Identifique onde a demanda está concentrada.</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{metrics.volumeByDemand.reduce((total, item) => total + item.total, 0)} tickets</span></div>{metrics.volumeByDemand.length === 0 ? <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700">Ainda não há tickets para exibir neste painel.</div> : <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={metrics.volumeByDemand} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, .25)" /><XAxis dataKey="queueName" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: 'rgba(37, 99, 235, .06)' }} contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0' }} /><Bar dataKey="total" name="Tickets" fill="#2563eb" radius={[8, 8, 2, 2]} /></BarChart></ResponsiveContainer></div>}</section><TeamPresence /></>}
    </div></main>
  );
};

export default Dashboard;
