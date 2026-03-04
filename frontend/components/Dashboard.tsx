import React from 'react';
import { Ticket, TicketStatus } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

interface DashboardProps {
  tickets: Ticket[];
}

const aguardando = (t: Ticket) => t.status === TicketStatus.AGUARDANDO;
const atendendo = (t: Ticket) => t.status === TicketStatus.ATENDENDO;
const resolvidos = (t: Ticket) => t.status === TicketStatus.RESOLVIDO;

const periodChartData = [
  { label: '02/02 06:00', value: 12 },
  { label: '05/02 09:00', value: 28 },
  { label: '08/02 12:00', value: 18 },
  { label: '11/02 15:00', value: 45 },
  { label: '14/02 18:00', value: 32 },
  { label: '17/02 09:00', value: 38 },
  { label: '19/02 12:00', value: 52 },
];

const Dashboard: React.FC<DashboardProps> = ({ tickets }) => {
  const totalAguardando = tickets.filter(aguardando).length;
  const totalAtendendo = tickets.filter(atendendo).length;
  const totalResolvidos = tickets.filter(resolvidos).length;
  const statusData = [
    { name: 'Aguardando', value: totalAguardando, color: '#f59e0b' },
    { name: 'Em Atendimento', value: totalAtendendo, color: '#3b82f6' },
    { name: 'Resolvidos', value: totalResolvidos, color: '#22c55e' },
    { name: 'Pendentes', value: tickets.filter(t => t.status === TicketStatus.PENDENTE).length, color: '#64748b' },
  ].filter((d) => d.value > 0);
  const onlineUsers = 11;
  const totalUsers = 14;
  const novosContatos = 29;

  return (
    <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-800/95 transition-colors">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Métricas de Atendimento</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Visão geral do desempenho do time em tempo real.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex items-center gap-4 shadow-sm dark:shadow-none transition-colors">
          <div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
            <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" title="donut" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Usuários online</p>
            <p className="text-2xl font-black text-slate-800 dark:text-slate-100">{onlineUsers}/{totalUsers}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm dark:shadow-none">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Atendimentos aguardando</p>
          <p className="text-2xl font-black text-slate-800 dark:text-slate-100">{totalAguardando}</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex items-center gap-3 shadow-sm dark:shadow-none">
          <div className="h-16 w-16 shrink-0">
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="50%" innerRadius={18} outerRadius={28} dataKey="value">
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full rounded-full bg-slate-200 dark:bg-slate-700" />
            )}
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Atendimentos abertos</p>
            <p className="text-2xl font-black text-slate-800 dark:text-slate-100">{totalAguardando + totalAtendendo}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-6">
        <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Período</span>
        <select className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none">
          <option>Personalizado</option>
        </select>
        <input type="datetime-local" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        <input type="datetime-local" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex items-center gap-3 shadow-sm dark:shadow-none">
          <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-600/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Atendimentos resolvidos</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100">{totalResolvidos}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex items-center gap-3 shadow-sm dark:shadow-none">
          <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-600/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Novos contatos</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100">{novosContatos}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex items-center gap-3 shadow-sm dark:shadow-none">
          <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-600/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Tempo médio atendimento</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100">2h 27m</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex items-center gap-3 shadow-sm dark:shadow-none">
          <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-600/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Tempo médio de espera</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100">0h 51m</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm dark:shadow-none">
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-4">Atendimentos no período</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={periodChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} labelStyle={{ color: '#e2e8f0' }} />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
