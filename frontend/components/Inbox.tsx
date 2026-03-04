
import React, { useState, useMemo, useEffect } from 'react';
import { Ticket, Message, User, TicketStatus, TicketPriority } from '../types';
import ChatWindow from './ChatWindow';
import TicketDetailPanel from './TicketDetailPanel';
import { Icons } from '../constants';
import { mockTicketTypes } from '../services/mockData';

interface InboxProps {
  tickets: Ticket[];
  messages: Message[];
  onPullTicket: (id: string) => void;
  onSendMessage: (id: string, content: string, isInternal?: boolean) => void;
  currentUser: User;
}

const Inbox: React.FC<InboxProps> = ({ tickets, messages, onPullTicket, onSendMessage, currentUser }) => {
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TicketStatus>(TicketStatus.ATENDENDO);
  const [now, setNow] = useState(new Date());

  // Atualiza tempo de espera a cada minuto
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const filteredTickets = useMemo(() => {
    return tickets
      .filter(t => t.status === filter)
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }, [tickets, filter]);

  const activeTicket = useMemo(() => 
    tickets.find(t => t.id === selectedTicketId), 
  [tickets, selectedTicketId]);

  const activeMessages = useMemo(() => 
    messages.filter(m => m.ticketId === selectedTicketId), 
  [messages, selectedTicketId]);

  const getStatusBadge = (status: TicketStatus) => {
    const styles = {
      [TicketStatus.AGUARDANDO]: 'bg-amber-100 text-amber-700 border-amber-200',
      [TicketStatus.ATENDENDO]: 'bg-blue-100 text-blue-700 border-blue-200',
      [TicketStatus.PENDENTE]: 'bg-slate-100 text-slate-700 border-slate-200',
      [TicketStatus.RESOLVIDO]: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      [TicketStatus.FECHADO]: 'bg-slate-200 text-slate-500 border-slate-300',
    };
    return styles[status] || styles[TicketStatus.AGUARDANDO];
  };

  const getTicketType = (typeId?: string) => {
    return mockTicketTypes.find(tt => tt.id === typeId);
  };

  const getWaitTime = (createdAt: Date) => {
    const diff = Math.floor((now.getTime() - createdAt.getTime()) / 60000);
    if (diff < 60) return `${diff} min`;
    return `${Math.floor(diff/60)}h ${diff%60}m`;
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Lista de Tickets */}
      <div className="w-80 lg:w-96 flex flex-col border-r border-slate-200 bg-white">
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-xl font-bold mb-4 text-slate-800">Atendimentos</h2>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {[TicketStatus.ATENDENDO, TicketStatus.AGUARDANDO].map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border ${
                  filter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredTickets.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">Nenhum chamado pendente.</div>
          ) : (
            filteredTickets.map(ticket => {
              const type = getTicketType(ticket.typeId);
              const isUrgentSLA = ticket.status === TicketStatus.AGUARDANDO && 
                                 (ticket.slaDeadline.getTime() - now.getTime()) < 1000 * 60 * 15;

              return (
                <button
                  key={ticket.id}
                  onClick={() => setSelectedTicketId(ticket.id)}
                  className={`w-full text-left p-4 hover:bg-slate-50 transition-all relative border-l-4 ${
                    selectedTicketId === ticket.id ? 'bg-blue-50/50 border-blue-600' : 'border-transparent'
                  }`}
                >
                  {/* Indicador Lateral Colorido por Tipo */}
                  <div 
                    className="absolute left-0 top-0 bottom-0 w-1.5" 
                    style={{ backgroundColor: type?.color || '#cbd5e1' }}
                  ></div>

                  <div className="flex justify-between items-start mb-1 ml-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">#{ticket.id}</span>
                    <span className="text-[10px] font-bold text-slate-400">{getWaitTime(ticket.createdAt)}</span>
                  </div>
                  
                  <div className="ml-2">
                    <h3 className="font-bold text-slate-800 line-clamp-1 mb-2 text-sm leading-tight">{ticket.subject}</h3>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black border uppercase ${getStatusBadge(ticket.status)}`}>
                          {ticket.status}
                        </span>
                        {type && (
                          <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
                             <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: type.color }}></div>
                             {type.name}
                          </span>
                        )}
                      </div>
                      
                      {isUrgentSLA && (
                        <div className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Janela de Chat */}
      <div className="flex-1 flex overflow-hidden">
        {activeTicket ? (
          <>
            <div className="flex-1 flex flex-col bg-slate-50 relative">
              <ChatWindow 
                ticket={activeTicket} 
                messages={activeMessages} 
                onSendMessage={onSendMessage}
                onPullTicket={onPullTicket}
                currentUser={currentUser}
              />
            </div>
            <div className="hidden xl:block w-80 border-l border-slate-200 bg-white">
              <TicketDetailPanel ticket={activeTicket} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-50">
            <div className="text-center p-8">
              <div className="w-20 h-20 bg-white shadow-xl shadow-slate-200 rounded-3xl flex items-center justify-center mx-auto mb-6 text-blue-600">
                 <Icons.Inbox className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Pronto para atender?</h2>
              <p className="text-slate-500 max-w-xs mx-auto mt-2">Selecione um cliente na lista ao lado ou aguarde novas interações.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Inbox;
