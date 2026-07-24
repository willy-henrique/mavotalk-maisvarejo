import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiGet } from '../services/api';

type SupportMetrics = {
  totalAguardando: number;
  totalAtendimento: number;
  totalEncerrado: number;
  firstResponseAverageMinutes: number | null;
  satisfactionAverage: number | null;
  volumeByDemand: Array<{
    queueName: string;
    colorHex: string;
    total: number;
  }>;
};

const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<SupportMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    apiGet<{ metrics: SupportMetrics }>('/api/dashboard/metrics')
      .then((data) => mounted && setMetrics(data.metrics))
      .catch((reason) => mounted && setError(reason instanceof Error ? reason.message : 'Falha ao carregar métricas'))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return <div className="flex-1 p-8 text-slate-500 dark:text-slate-400">Carregando métricas de atendimento...</div>;
  }
  if (error || !metrics) {
    return (
      <div className="flex-1 p-8 bg-slate-50 dark:bg-slate-800/95">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-700">{error || 'Métricas indisponíveis.'}</div>
      </div>
    );
  }

  const cards = [
    { label: 'Aguardando', value: metrics.totalAguardando },
    { label: 'Em atendimento', value: metrics.totalAtendimento },
    { label: 'Encerrados', value: metrics.totalEncerrado },
    {
      label: 'Primeira resposta',
      value: metrics.firstResponseAverageMinutes == null ? 'Sem dados' : `${metrics.firstResponseAverageMinutes} min`,
    },
    {
      label: 'Satisfação',
      value: metrics.satisfactionAverage == null ? 'Sem dados' : `${metrics.satisfactionAverage.toFixed(2)} / 5`,
    },
  ];

  return (
    <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-800/95 transition-colors">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Métricas de atendimento</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Chamados, filas, SLA e satisfação. Dados gerenciais de vendas ficam na área Negócio.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{card.label}</p>
            <p className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-2">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
        <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-5">Volume por fila</h2>
        {metrics.volumeByDemand.length === 0 ? (
          <div className="py-16 text-center text-slate-500">Ainda não há tickets para exibir.</div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.volumeByDemand}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="queueName" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="total" name="Tickets" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
