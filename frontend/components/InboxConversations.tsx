import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { User } from '../types';
import { Icons } from '../constants';
import { apiFetch, apiPatch, apiPost } from '../services/api';

type ConversationStatus = 'aguardando' | 'em_atendimento' | 'pendente_cliente' | 'encerrado';

type ApiMessage = {
  id: string;
  content: string;
  direction: 'inbound' | 'outbound';
  createdAt: string;
  type?: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  cloudinaryPublicId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  externalId?: string | null;
};

type ApiConversation = {
  id: string;
  status: ConversationStatus;
  triageCompleted: boolean;
  createdAt: string;
  updatedAt: string;
  contact: { id: string; name: string | null; phoneNumber: string | null; avatarUrl?: string | null };
  queue: { id: string; name: string; colorHex?: string } | null;
  ticket: Record<string, unknown> | null;
  messages: ApiMessage[];
};

const statusToLabel: Record<string, string> = {
  aguardando: 'AGUARDANDO',
  em_atendimento: 'ATENDENDO',
  pendente_cliente: 'PENDENTE',
  encerrado: 'FINALIZADO',
};

interface InboxConversationsProps {
  currentUser: User;
}

type QuickReply = { id: string; name: string; content: string; category?: string | null };

function formatMessageTime(createdAt?: string) {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export const InboxConversations: React.FC<InboxConversationsProps> = ({ currentUser }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ConversationStatus>('em_atendimento');
  const [tabAbertas, setTabAbertas] = useState<'abertas' | 'resolvidos'>('abertas');
  /** Filtro por status dentro de "Abertas": null = todos, 'em_atendimento' | 'aguardando' */
  const [statusFilter, setStatusFilter] = useState<'em_atendimento' | 'aguardando' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [closing, setClosing] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [editContactName, setEditContactName] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [editContactError, setEditContactError] = useState('');
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplyIndex, setQuickReplyIndex] = useState(0);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [typingAgent, setTypingAgent] = useState<{ name: string } | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const didInitRef = useRef(false);

  const fetchConversations = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await apiFetch('/api/conversations', { method: 'GET' });
      const data = (await res.json()) as { conversations?: ApiConversation[] };
      if (res.ok && Array.isArray(data.conversations)) {
        setConversations(data.conversations);
        // Só seleciona automaticamente na carga inicial da tela.
        if (!didInitRef.current) {
          const firstOpen = data.conversations.find((c) => c.status !== 'encerrado');
          if (!selectedIdRef.current && firstOpen) {
            setSelectedId(firstOpen.id);
          }
          didInitRef.current = true;
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);
  const handleCloseConversation = async () => {
    if (!selectedId) return;
    await closeConversationById(selectedId, true);
  };

  const closeConversationById = async (id: string, sendSurvey = false) => {
    const wasSelected = selectedId === id;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'encerrado' as const } : c))
    );
    if (wasSelected) {
      setSelectedId(null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('conversation');
        return next;
      });
    }
    setClosing(true);
    try {
      await apiPost(`/api/conversations/${id}/close`, { reason: 'Finalizado pelo atendente', sendSurvey });
      // Reload em background, sem travar o botão.
      void fetchConversations(false);
    } catch (e) {
      console.error(e);
      void fetchConversations(false);
    } finally {
      setClosing(false);
    }
  };

  const openEditContact = () => {
    if (!selected?.contact) return;
    setEditContactName(selected.contact.name ?? '');
    setEditContactPhone(selected.contact.phoneNumber ?? '');
    setEditContactError('');
    setEditContactOpen(true);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected?.contact?.id) return;
    setSavingContact(true);
    setEditContactError('');
    try {
      await apiPatch(`/api/contacts/${selected.contact.id}`, {
        name: editContactName.trim() || undefined,
        phoneNumber: editContactPhone.trim() || undefined,
      });
      await fetchConversations(false);
      setEditContactOpen(false);
    } catch (err) {
      setEditContactError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSavingContact(false);
    }
  };

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);

  const fetchQuickReplies = useCallback(async () => {
    try {
      const res = await apiFetch('/api/quick-replies', { method: 'GET' });
      const data = (await res.json()) as { quickReplies?: QuickReply[] };
      if (res.ok && Array.isArray(data.quickReplies)) setQuickReplies(data.quickReplies);
    } catch {
      setQuickReplies([]);
    }
  }, []);

  const showQuickReplies = messageInput.startsWith('/');
  const quickReplySearch = showQuickReplies ? messageInput.slice(1).toLowerCase().trim() : '';
  const filteredQuickReplies = quickReplySearch
    ? quickReplies.filter(
        (qr) =>
          qr.name.toLowerCase().includes(quickReplySearch) ||
          (qr.content || '').toLowerCase().includes(quickReplySearch)
      )
    : quickReplies;

  const handleQuickReplySelect = (content: string) => {
    setMessageInput(content);
    setQuickReplyOpen(false);
    setQuickReplyIndex(0);
    messageInputRef.current?.focus();
  };

  const handleMessageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setMessageInput(v);
    if (v.startsWith('/')) {
      setQuickReplyOpen(true);
      setQuickReplyIndex(0);
      if (quickReplies.length === 0) fetchQuickReplies();
    } else {
      setQuickReplyOpen(false);
    }
    if (selectedId && v.trim()) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      socketRef.current?.emit('typing:start', {
        conversationId: selectedId,
        userId: currentUser.id,
        userName: currentUser.name || 'Atendente',
      });
      const base = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '');
      fetch(`${base}/api/conversations/${selectedId}/typing`, { method: 'POST', credentials: 'include' }).catch(() => {});
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.emit('typing:stop', { conversationId: selectedId, userId: currentUser.id });
        setTypingAgent(null);
      }, 2000);
    }
  };

  const handleMessageInputBlur = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (selectedId) {
      socketRef.current?.emit('typing:stop', { conversationId: selectedId, userId: currentUser.id });
      setTypingAgent(null);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId || !file.type.startsWith('image/') || uploadingImage) return;
    setUploadingImage(true);
    e.target.value = '';
    try {
      const formData = new FormData();
      formData.append('file', file);
      const base = typeof window !== 'undefined' && import.meta.env.DEV ? '' : (import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '');
      const res = await fetch(`${base}/api/conversations/${selectedId}/messages/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (res.ok) {
        await fetchConversations(false);
      } else {
        const data = await res.json().catch(() => ({}));
        const msg = (data as { error?: string }).error || 'Erro ao enviar imagem';
        console.error(msg);
        alert(msg);
      }
    } catch (err) {
      console.error(err);
      alert('Falha ao enviar imagem. Verifique se o Cloudinary está configurado corretamente no .env (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleMessageKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showQuickReplies || !quickReplyOpen || filteredQuickReplies.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setQuickReplyIndex((i) => (i + 1) % filteredQuickReplies.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setQuickReplyIndex((i) => (i - 1 + filteredQuickReplies.length) % filteredQuickReplies.length);
    } else if (e.key === 'Enter' && filteredQuickReplies[quickReplyIndex]) {
      e.preventDefault();
      handleQuickReplySelect(filteredQuickReplies[quickReplyIndex].content);
    } else if (e.key === 'Escape') {
      setQuickReplyOpen(false);
    }
  };

  // Em "Abertas", mostramos apenas tickets realmente em fila ou em atendimento.
  // Conversas em triagem (status 'pendente_cliente') ficam escondidas até o cliente escolher a opção.
  const openStatuses: ConversationStatus[] = ['aguardando', 'em_atendimento'];
  const filtered =
    tabAbertas === 'abertas'
      ? conversations
          .filter((c) => openStatuses.includes(c.status))
          .filter((c) => (statusFilter ? c.status === statusFilter : true))
      : conversations.filter((c) => c.status === 'encerrado');
  const selected = conversations.find((c) => c.id === selectedId);
  const countAtendendo = conversations.filter((c) => c.status === 'em_atendimento').length;
  const countAguardando = conversations.filter((c) => c.status === 'aguardando').length;

  useEffect(() => {
    const conversationFromUrl = searchParams.get('conversation');
    if (conversationFromUrl) {
      setSelectedId(conversationFromUrl);
      setFilter('em_atendimento');
    }
  }, [searchParams]);

  // Na aba Abertas, não manter conversa encerrada selecionada — só em Resolvidos
  useEffect(() => {
    if (tabAbertas === 'abertas' && selected?.status === 'encerrado') {
      setSelectedId(null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('conversation');
        return next;
      });
    }
  }, [tabAbertas, selected?.id, selected?.status, setSearchParams]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedId, selected?.messages?.length]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Se o usuário trocar de conversa enquanto estiver "Finalizando...",
  // garantimos que o estado de loading de fechamento não fique preso.
  useEffect(() => {
    setClosing(false);
  }, [selectedId]);

  useEffect(() => {
    fetchConversations(true);
    const socket = io(window.location.origin, { path: '/socket.io' });
    socketRef.current = socket;
    socket.on('conversation.created', () => fetchConversations(false));
    socket.on('conversation.updated', () => fetchConversations(false));
    socket.on('message.created', (payload: { conversationId?: string }) => {
      fetchConversations(false);
      if (payload?.conversationId && payload.conversationId !== selectedIdRef.current && document.hidden) {
        try {
          if (Notification.permission === 'granted') {
            new Notification('WillTalk – Nova mensagem', { body: 'Você recebeu uma nova mensagem no chat.' });
          }
        } catch {
          // ignore
        }
      }
    });
    socket.on('typing', (payload: { conversationId: string; userName: string; isTyping: boolean }) => {
      if (payload.conversationId !== selectedIdRef.current) return;
      setTypingAgent(payload.isTyping ? { name: payload.userName } : null);
    });
    const t = setInterval(() => fetchConversations(false), 15000);
    return () => {
      socketRef.current = null;
      socket.disconnect();
      clearInterval(t);
    };
  }, [fetchConversations]);

  const handleAssign = async () => {
    if (!selectedId) return;
    setAssigning(true);
    try {
      await apiPost(`/api/conversations/${selectedId}/assign`, {});
      // Realtime + otimismo já atualizam; não bloquear a UI esperando reload completo.
      void fetchConversations(false);
    } catch (e) {
      console.error(e);
    } finally {
      setAssigning(false);
    }
  };

  const handleAssignFromList = async (id: string) => {
    setAssigning(true);
    const previousSelected = selectedId;
    setSelectedId(id);
    // Otimismo: marca como em_atendimento imediatamente
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'em_atendimento' as ConversationStatus } : c)),
    );
    try {
      await apiPost(`/api/conversations/${id}/assign`, {});
      void fetchConversations(false);
    } catch (e) {
      console.error(e);
      // Reverte em caso de erro
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'aguardando' as ConversationStatus } : c)),
      );
      setSelectedId(previousSelected);
    } finally {
      setAssigning(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = messageInput.trim();
    if (!selectedId || !text || sending) return;
    setMessageInput('');
    const optId = `opt-${Date.now()}`;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: [
                ...(c.messages || []),
                {
                  id: optId,
                  content: text,
                  direction: 'outbound' as const,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : c
      )
    );
    setSending(true);
    try {
      await apiPost(`/api/conversations/${selectedId}/messages`, { content: text });
    } catch (err) {
      console.error(err);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? { ...c, messages: (c.messages || []).filter((m) => m.id !== optId) }
            : c
        )
      );
    } finally {
      setSending(false);
    }
  };

  const getWaitTime = (updatedAt: string) => {
    const diff = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000);
    if (diff < 60) return `${diff} min`;
    return `${Math.floor(diff / 60)}h ${diff % 60}m`;
  };

  const lastMessage = (c: ApiConversation) => {
    const msgs = c.messages || [];
    return msgs[msgs.length - 1];
  };

  return (
    <div className="flex flex-1 overflow-hidden min-h-0 min-w-0 bg-slate-50 dark:bg-slate-800/95 transition-colors">
      <div className="w-80 lg:w-[22rem] flex flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 shrink-0 min-h-0 overflow-hidden transition-colors">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-1 mb-4">
            <button
              type="button"
              onClick={() => { setTabAbertas('abertas'); setStatusFilter(null); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-bold transition-all ${
                tabAbertas === 'abertas'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'bg-slate-200 text-slate-600 hover:text-slate-800 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M5.625 1.5H9a3.75 3.75 0 013.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 013.75 3.75v7.875c0 1.035-.84 1.875-1.875 1.875H5.625a1.875 1.875 0 01-1.875-1.875V3.375c0-1.036.84-1.875 1.875-1.875zm6 16.5c.66 0 1.277-.19 1.797-.518L12 13.439l-1.422 1.043c-.52.328-1.137.518-1.797.518-.825 0-1.5-.675-1.5-1.5s.675-1.5 1.5-1.5c.66 0 1.277.19 1.797.518L12 11.061l1.422-1.043C13.863 9.69 14.478 9.5 15.139 9.5c.825 0 1.5.675 1.5 1.5s-.675 1.5-1.5 1.5z" clipRule="evenodd" />
              </svg>
              ABERTAS
            </button>
            <button
              type="button"
              onClick={() => { setTabAbertas('resolvidos'); setStatusFilter(null); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-bold transition-all ${
                tabAbertas === 'resolvidos'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'bg-slate-200 text-slate-600 hover:text-slate-800 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
              </svg>
              RESOLVIDOS
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              NOVO
            </button>
            <button type="button" className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-white transition-colors" aria-label="Notificações">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.206A8.217 8.217 0 005.25 9.75V9z" clipRule="evenodd" />
              </svg>
            </button>
            <select className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none">
              <option>Filas</option>
            </select>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === 'em_atendimento' ? null : 'em_atendimento'))}
              className={`flex items-center gap-2 text-xs font-bold rounded-lg px-3 py-2 transition-all ${
                statusFilter === 'em_atendimento'
                  ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-400/50 dark:ring-blue-500/50'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
              }`}
              title={statusFilter === 'em_atendimento' ? 'Mostrar todos' : 'Filtrar por em atendimento'}
            >
              <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600/90 px-1.5 text-[10px] text-white">{countAtendendo}</span>
              ATENDENDO
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === 'aguardando' ? null : 'aguardando'))}
              className={`flex items-center gap-2 text-xs font-bold rounded-lg px-3 py-2 transition-all ${
                statusFilter === 'aguardando'
                  ? 'bg-red-600 text-white shadow-md ring-2 ring-red-400/50 dark:ring-red-500/50'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
              }`}
              title={statusFilter === 'aguardando' ? 'Mostrar todos' : 'Filtrar por aguardando'}
            >
              <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500/90 px-1.5 text-[10px] text-white">{countAguardando}</span>
              AGUARDANDO
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700/80">
          {loading ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">Nenhum ticket {tabAbertas === 'abertas' ? 'aberto' : 'resolvido'}.</div>
          ) : (
            filtered.map((c) => {
              const last = lastMessage(c);
              const isSelected = c.id === selectedId;
              const hasNewMessage = last?.direction === 'inbound' && !isSelected && c.status !== 'encerrado';
              const unreadCount = hasNewMessage ? 1 : 0;
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(c.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedId(c.id)}
                  className={`w-full text-left p-4 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all relative border-l-4 cursor-pointer ${
                    isSelected ? 'bg-blue-50 dark:bg-blue-600/20 border-blue-500' : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1 rounded-l"
                    style={{ backgroundColor: c.queue?.colorHex || '#475569' }}
                  />
                  <div className="flex justify-between items-start gap-2 mb-1 ml-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">#{c.id.slice(0, 8)}</span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {unreadCount > 0 && (
                        <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white shrink-0">
                          {unreadCount}
                        </span>
                      )}
                      <span className="text-[10px] font-medium text-slate-500 shrink-0">{getWaitTime(c.updatedAt)}</span>
                      {c.status === 'aguardando' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAssignFromList(c.id);
                          }}
                          disabled={assigning}
                          className="shrink-0 px-2 py-0.5 rounded-lg bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700 disabled:opacity-50"
                          title="Puxar atendimento"
                        >
                          Puxar
                        </button>
                      )}
                      {(c.status === 'em_atendimento' || c.status === 'aguardando') && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeConversationById(c.id);
                          }}
                          disabled={closing}
                          className="shrink-0 p-1 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400 dark:hover:text-white disabled:opacity-50"
                          title="Fechar chamado"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="ml-2 flex gap-2">
                    <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 text-sm font-bold shrink-0 overflow-hidden">
                      {c.contact?.avatarUrl ? (
                        <img
                          src={c.contact.avatarUrl}
                          alt={c.contact.name || c.contact.phoneNumber || 'Contato'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        (c.contact?.name || c.contact?.phoneNumber || '?')[0].toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-slate-800 dark:text-slate-100 line-clamp-1 text-sm">
                        {c.contact?.name || c.contact?.phoneNumber || 'Contato'}
                      </h3>
                      {c.queue && (
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[10px] font-bold text-white mt-0.5"
                          style={{ backgroundColor: c.queue.colorHex || '#64748b' }}
                        >
                          {c.queue.name}
                        </span>
                      )}
                      {last && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{last.content}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-800/50 min-w-0 min-h-0 overflow-hidden transition-colors">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="text-center max-w-sm">
              <div className="w-20 h-20 rounded-2xl bg-slate-200 dark:bg-slate-700/80 flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-slate-400 dark:text-slate-500">
                  <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97-1.94.284-3.916.455-5.922.505a.803.803 0 00-.921.921 11.447 11.447 0 01.505 5.922c.292 1.978 2.024 3.348 3.97 3.348h6.02c1.946 0 3.678-1.37 3.97-3.348.284-1.94.455-3.916.505-5.922a.803.803 0 00-.921-.921 11.447 11.447 0 01-5.922-.505C18.318 18.37 16.586 17 14.63 17h-6.02c-1.946 0-3.678 1.37-3.97 3.348A11.464 11.464 0 013.381 16.18a.803.803 0 00.921.921 11.446 11.446 0 005.922.505c1.978-.292 3.348-2.024 3.348-3.97v-6.02c0-1.946-1.37-3.678-3.348-3.97A11.464 11.464 0 013.381 7.82a.803.803 0 00-.921-.921 11.446 11.446 0 01-.505-5.922c.292-1.978 2.024-3.348 3.97-3.348h6.02c1.946 0 3.678 1.37 3.97 3.348.05 1.006.121 2.032.505 3.206z" clipRule="evenodd" />
                </svg>
              </div>
              <p className="text-slate-600 dark:text-slate-300 font-semibold text-lg">Selecione um ticket para começar a conversar.</p>
              <p className="text-slate-500 text-sm mt-1">Escolha uma conversa na lista à esquerda ou aguarde novos atendimentos.</p>
            </div>
          </div>
        ) : (
          <>
            <header className="px-8 py-5 bg-white dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 text-sm font-bold shrink-0 overflow-hidden">
                  {selected.contact?.avatarUrl ? (
                    <img
                      src={selected.contact.avatarUrl}
                      alt={selected.contact.name || selected.contact.phoneNumber || 'Contato'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    (selected.contact?.name || selected.contact?.phoneNumber || '?')[0].toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-slate-800 dark:text-slate-100 truncate">
                    {selected.contact?.name || selected.contact?.phoneNumber || 'Contato'}
                  </h2>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <p className="text-slate-500 dark:text-slate-400">{selected.contact?.phoneNumber}</p>
                    {selected.ticket && (selected.ticket as { assignee?: { name: string } }).assignee?.name && (
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                        Atendido por: {(selected.ticket as { assignee: { name: string } }).assignee.name}
                      </span>
                    )}
                    {typingAgent && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 animate-pulse">
                        {typingAgent.name} está digitando...
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openEditContact}
                  className="shrink-0 p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  title="Editar contato"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2">
                {selected.status === 'aguardando' && (
                  <button
                    type="button"
                    onClick={handleAssign}
                    disabled={assigning}
                    className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {assigning ? 'Assumindo...' : 'Puxar Atendimento'}
                  </button>
                )}
                {selected.status === 'em_atendimento' && (
                  <button
                    type="button"
                    onClick={handleCloseConversation}
                    disabled={closing}
                    className="bg-slate-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
                  >
                    {closing ? 'Finalizando...' : 'Finalizar chamado'}
                  </button>
                )}
              </div>
            </header>
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-3 min-h-0 flex flex-col">
              {(selected.messages || []).map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                      m.direction === 'outbound'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {m.type === 'audio' && m.mediaUrl ? (
                      <audio controls src={m.mediaUrl} className="max-w-full h-10" preload="metadata">
                        Seu navegador não suporta áudio.
                      </audio>
                    ) : m.type === 'image' && (m.cloudinaryPublicId || m.mediaUrl) ? (
                      <a
                        href={m.cloudinaryPublicId ? `/api/media/signed?publicId=${encodeURIComponent(m.cloudinaryPublicId)}` : m.mediaUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={m.cloudinaryPublicId ? `/api/media/signed?publicId=${encodeURIComponent(m.cloudinaryPublicId)}` : m.mediaUrl || ''}
                          alt=""
                          className="max-w-full rounded-lg max-h-64 object-contain"
                        />
                      </a>
                    ) : m.direction === 'outbound' && m.authorName ? (
                      <>
                        <span className="font-semibold block mb-1">{m.authorName}:</span>
                        {m.content}
                      </>
                    ) : (
                      m.content
                    )}
                    <div
                      className={`mt-1 text-[10px] text-slate-400 dark:text-slate-300 flex items-center gap-1 ${
                        m.direction === 'outbound' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {m.direction === 'outbound' && (
                        <>
                          {(!m.externalId || m.id.startsWith('opt-')) ? (
                            // Relógio enquanto a mensagem ainda está sendo enviada/sincronizada
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              className="w-3 h-3 text-slate-500 dark:text-white"
                              aria-hidden="true"
                            >
                              <path
                                fill="currentColor"
                                d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8a8.009 8.009 0 0 1-8 8Zm.5-13h-1.5v6l5.25 3.15l.75-1.23l-4.5-2.67Z"
                              />
                            </svg>
                          ) : (
                            // Dois risquinhos (mensagem enviada) igual WhatsApp
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              className="w-3 h-3 text-slate-500 dark:text-white"
                              aria-hidden="true"
                            >
                              <path
                                fill="currentColor"
                                d="M9.5 16.5L4 11l1.4-1.4L9.5 13.7l9.1-9.1L20 6l-10.5 10.5Zm6 0L10 11l1.4-1.4l5.1 5.1l6.1-6.1L24 10Z"
                              />
                            </svg>
                          )}
                        </>
                      )}
                      <span>{formatMessageTime(m.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            {selected.status !== 'encerrado' ? (
              <form onSubmit={handleSendMessage} className="p-4 bg-white dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-700 shrink-0 transition-colors">
                <div className="flex gap-2 relative">
                  <label className="shrink-0 flex items-center justify-center w-12 h-12 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50 text-slate-500 dark:text-slate-400">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={sending || uploadingImage}
                      className="hidden"
                    />
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-slate-500">
                      <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-3.69l-2.97-2.97a.75.75 0 00-1.06 0l-1.5 1.5a.75.75 0 01-1.06 0l-2.44-2.44a.75.75 0 00-1.06 0l-3.09 3.1z" clipRule="evenodd" />
                    </svg>
                  </label>
                  <div className="flex-1 relative">
                    <input
                      ref={messageInputRef}
                      type="text"
                      value={messageInput}
                      onChange={handleMessageInputChange}
                      onBlur={handleMessageInputBlur}
                      onKeyDown={handleMessageKeyDown}
                      placeholder="Digite a mensagem ou / para respostas rápidas"
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    {quickReplyOpen && filteredQuickReplies.length > 0 && (
                      <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-xl max-h-48 overflow-y-auto z-10">
                        {filteredQuickReplies.map((qr, i) => (
                          <button
                            key={qr.id}
                            type="button"
                            onClick={() => handleQuickReplySelect(qr.content)}
                            className={`w-full text-left px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-700 first:rounded-t-xl last:rounded-b-xl ${
                              i === quickReplyIndex ? 'bg-blue-50 dark:bg-blue-600/30' : ''
                            }`}
                          >
                            <span className="font-medium text-slate-800 dark:text-slate-200">{qr.name}</span>
                            {qr.category && (
                              <span className="ml-2 text-xs text-slate-500">{qr.category}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={sending || !messageInput.trim()}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold disabled:opacity-50"
                  >
                    {sending ? '...' : 'Enviar'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-4 bg-slate-100 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 shrink-0 text-center text-slate-500 dark:text-slate-400 text-sm">
                Chamado finalizado. Nenhuma nova mensagem pode ser enviada.
              </div>
            )}
          </>
        )}

        {editContactOpen && selected?.contact && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => !savingContact && setEditContactOpen(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-slate-800 mb-4">Editar contato</h3>
              <form onSubmit={handleSaveContact} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome</label>
                  <input
                    type="text"
                    value={editContactName}
                    onChange={(e) => setEditContactName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Nome do contato"
                    disabled={savingContact}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telefone (WhatsApp)</label>
                  <input
                    type="text"
                    value={editContactPhone}
                    onChange={(e) => setEditContactPhone(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="whatsapp:+5562999999999"
                    disabled={savingContact}
                  />
                </div>
                {editContactError && (
                  <p className="text-sm text-rose-600 font-medium">{editContactError}</p>
                )}
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => !savingContact && setEditContactOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingContact || (!editContactName.trim() && !editContactPhone.trim())}
                    className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingContact ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InboxConversations;
