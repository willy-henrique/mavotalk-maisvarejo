
import React from 'react';
import { Ticket } from '../types';
import { mockCustomers } from '../services/mockData';

interface TicketDetailPanelProps {
  ticket: Ticket;
}

const TicketDetailPanel: React.FC<TicketDetailPanelProps> = ({ ticket }) => {
  const customer = mockCustomers.find(c => c.id === ticket.customerId);

  if (!customer) return null;

  return (
    <div className="h-full flex flex-col p-6 space-y-8 overflow-y-auto">
      {/* Customer Info */}
      <section>
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Cliente</h4>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center border border-slate-200 overflow-hidden">
             <img src={`https://picsum.photos/seed/${customer.id}/48/48`} alt="Avatar" />
          </div>
          <div>
            <p className="font-bold text-slate-800 leading-tight">{customer.name}</p>
            <p className="text-xs text-slate-500">{customer.company}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">E-mail</span>
            <span className="text-slate-700 font-medium truncate ml-4">{customer.email}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Telefone</span>
            <span className="text-slate-700 font-medium">{customer.phone}</span>
          </div>
        </div>
      </section>

      {/* Ticket Details */}
      <section>
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Detalhes do Ticket</h4>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-400 mb-1">Categoria</p>
            <div className="px-3 py-2 bg-slate-50 rounded-lg border border-slate-100 text-sm font-medium">
              {ticket.category}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Tags</p>
            <div className="flex flex-wrap gap-2">
              {ticket.tags.map(tag => (
                <span key={tag} className="px-2 py-1 bg-blue-50 text-blue-600 text-[10px] font-bold rounded uppercase">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SLA Status */}
      <section>
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">SLA de Resolução</h4>
        <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-700">Tempo Restante</span>
            <span className="text-xs font-bold text-rose-500">2h 15m</span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-rose-500 w-[65%]"></div>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">Vence em: {ticket.slaDeadline.toLocaleDateString()} às 18:00</p>
        </div>
      </section>

      {/* Action Logs */}
      <section className="flex-1">
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Auditoria</h4>
        <div className="space-y-4">
          <div className="flex gap-3">
             <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0"></div>
             <div>
               <p className="text-[11px] font-bold text-slate-700">Ticket Criado</p>
               <p className="text-[10px] text-slate-400">Há 4 horas por Sistema</p>
             </div>
          </div>
          <div className="flex gap-3">
             <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0"></div>
             <div>
               <p className="text-[11px] font-bold text-slate-700">Prioridade alterada para Alta</p>
               <p className="text-[10px] text-slate-400">Há 2 horas por Admin</p>
             </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default TicketDetailPanel;
