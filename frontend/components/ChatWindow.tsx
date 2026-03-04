
import React, { useState, useEffect, useRef } from 'react';
import { Ticket, Message, User, TicketStatus } from '../types';
import { GeminiService } from '../services/geminiService';
import { mockTicketTypes } from '../services/mockData';

interface ChatWindowProps {
  ticket: Ticket;
  messages: Message[];
  onSendMessage: (ticketId: string, content: string, isInternal?: boolean) => void;
  onPullTicket: (id: string) => void;
  currentUser: User;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ ticket, messages, onSendMessage, onPullTicket, currentUser }) => {
  const [inputValue, setInputValue] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    onSendMessage(ticket.id, inputValue, isInternal);
    setInputValue('');
  };

  const currentType = mockTicketTypes.find(tt => tt.id === ticket.typeId);
  const isWaiting = ticket.status === TicketStatus.AGUARDANDO;
  const isAssignedToMe = ticket.agentId === currentUser.id;

  return (
    <div className="flex flex-col h-full">
      {/* Header Corporativo */}
      <header className="px-8 py-5 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-4">
          <div className="w-1.5 h-10 rounded-full" style={{ backgroundColor: currentType?.color || '#cbd5e1' }}></div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Atendimento #{ticket.id}</span>
              {currentType && (
                <span className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-black text-slate-500 uppercase border border-slate-200">
                  {currentType.name}
                </span>
              )}
            </div>
            <h2 className="font-bold text-slate-800">{ticket.subject}</h2>
          </div>
        </div>
        <div className="flex gap-2">
          {isWaiting && (
            <button 
              onClick={() => onPullTicket(ticket.id)}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20"
            >
              Puxar Atendimento
            </button>
          )}
          {!isWaiting && (
            <div className="flex items-center gap-2">
               <button className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all">
                Transferir
              </button>
              <button className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all shadow-md shadow-emerald-500/10">
                Finalizar
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Mensagens */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50/50"
      >
        {messages.map((m) => {
          const isMe = m.senderId === currentUser.id;
          const isBot = m.senderId === 'system' || m.type === 'BOT_MENU';

          return (
            <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] lg:max-w-[70%] rounded-2xl px-5 py-4 shadow-sm ${
                m.isInternal 
                  ? 'bg-amber-50 border border-amber-200 text-amber-900' 
                  : isMe 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/10' 
                    : isBot 
                      ? 'bg-slate-800 text-slate-200 border border-slate-700'
                      : 'bg-white border border-slate-200 text-slate-800'
              }`}>
                <div className="flex items-center justify-between gap-4 mb-2">
                  <span className="text-[10px] font-black opacity-60 uppercase tracking-widest">{m.senderName}</span>
                  {m.isInternal && <span className="bg-amber-200 text-amber-800 text-[8px] px-1.5 py-0.5 rounded font-black">INTERNA</span>}
                  {isBot && <span className="text-blue-400 text-[8px] font-black uppercase">AUTO</span>}
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                <div className="text-[9px] mt-2 opacity-50 text-right font-medium">
                  {m.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="p-6 bg-white border-t border-slate-200 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.05)]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-2">
             <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${isInternal ? 'bg-amber-500 border-amber-500' : 'bg-slate-100 border-slate-300 group-hover:border-slate-400'}`}>
                    {isInternal && <span className="text-white text-[10px]">✓</span>}
                  </div>
                  <input 
                    type="checkbox" 
                    className="hidden"
                    checked={isInternal} 
                    onChange={(e) => setIsInternal(e.target.checked)}
                  />
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nota Interna</span>
                </label>
             </div>
             <button className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1.5 hover:text-blue-700 transition-all">
               ✨ Gerar Sugestão (IA)
             </button>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={isAssignedToMe || isWaiting ? "Digite sua resposta..." : "Assuma o ticket para interagir"}
                disabled={!isAssignedToMe && !isWaiting}
                rows={2}
                className={`w-full p-4 rounded-2xl border transition-all resize-none text-sm ${
                  isInternal 
                    ? 'bg-amber-50 border-amber-200 focus:ring-amber-500' 
                    : 'bg-slate-50 border-slate-200 focus:ring-blue-600 focus:bg-white'
                } focus:outline-none focus:ring-2`}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={(!isAssignedToMe && !isWaiting) || !inputValue.trim()}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-xl ${
                inputValue.trim() ? 'bg-blue-600 text-white shadow-blue-500/20 hover:scale-105 active:scale-95' : 'bg-slate-100 text-slate-300 shadow-none'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 rotate-90">
                <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;
