import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { User } from '../types';
import { apiFetch, apiPatch, apiPost, getAccessToken, getApiBaseUrl, getApiUrl, getSocketUrl } from '../services/api';
import { Dialog } from './ui/Dialog';
import { AvatarPreviewDialog } from './ui/AvatarPreviewDialog';
import StartConversationDialog from './StartConversationDialog';

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
  /** Se o cliente recebeu o nome do atendente antes do texto. */
  withSignature?: boolean;
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

function isPdfMessage(message: ApiMessage): boolean {
  if (String(message.mimeType || '').toLowerCase() === 'application/pdf') return true;
  try {
    return /\.pdf$/i.test(new URL(String(message.mediaUrl || '')).pathname);
  } catch {
    return false;
  }
}

function documentTitle(message: ApiMessage): string {
  const content = String(message.content || '').trim();
  if (content && !/^\[(midia|mídia|documento)\]$/i.test(content)) return content;
  return isPdfMessage(message) ? 'Documento PDF' : 'Documento';
}

function isTrustedPdfFallbackUrl(value: string | null | undefined): boolean {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com';
  } catch {
    return false;
  }
}

async function validatedPdfBlob(response: Response): Promise<Blob> {
  const blob = await response.blob();
  if (blob.size > 20 * 1024 * 1024) {
    throw new Error('O PDF excede o limite de 20 MB.');
  }
  const header = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const signature = String.fromCharCode(...header);
  if (!signature.includes('%PDF-')) {
    throw new Error('O arquivo recebido não contém um PDF válido.');
  }
  return blob.type === 'application/pdf'
    ? blob
    : new Blob([blob], { type: 'application/pdf' });
}

/**
 * A assinatura é escolha de quem atende, então precisa sobreviver à recarga: sem
 * guardar, o botão voltava ao padrão da loja e o nome do atendente reaparecia sem
 * ninguém pedir. Fica por atendente, no próprio navegador.
 */
function signatureStorageKey(userId: string): string {
  return `willtalk.assinatura.${userId}`;
}

function readStoredSignature(userId: string): boolean | null {
  try {
    const value = window.localStorage.getItem(signatureStorageKey(userId));
    return value === 'on' ? true : value === 'off' ? false : null;
  } catch {
    return null;
  }
}

function storeSignature(userId: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(signatureStorageKey(userId), enabled ? 'on' : 'off');
  } catch {
    // Navegador sem storage (aba anônima restrita): a assinatura só não persiste.
  }
}

function pdfDownloadName(message: ApiMessage): string {
  const base = documentTitle(message)
    .replace(/\.pdf$/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || `documento-${message.id.slice(0, 8)}`}.pdf`;
}

export const InboxConversations: React.FC<InboxConversationsProps> = ({ currentUser }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [socketStatus, setSocketStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting');
  const [tabAbertas, setTabAbertas] = useState<'abertas' | 'resolvidos'>('abertas');
  /** Filtro por status dentro de "Abertas": null = todos. */
  const [statusFilter, setStatusFilter] = useState<'em_atendimento' | 'aguardando' | 'pendente_cliente' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  /** Assinatura deste envio. Começa na escolha guardada do atendente e, se não
   * houver nenhuma, no padrão da organização — sem alterar a configuração dos demais. */
  const [storedSignature] = useState(() => readStoredSignature(currentUser.id));
  const [signatureOn, setSignatureOn] = useState(storedSignature ?? true);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
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
  const [listSearch, setListSearch] = useState('');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [openingPdfId, setOpeningPdfId] = useState<string | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);
  const [typingAgent, setTypingAgent] = useState<{ name: string } | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<{ url: string; name: string } | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signatureTouchedRef = useRef(false);
  const pdfObjectUrlsRef = useRef<Set<string>>(new Set());

  const toggleSignature = () => {
    signatureTouchedRef.current = true;
    const next = !signatureOn;
    storeSignature(currentUser.id, next);
    setSignatureOn(next);
  };

  const selectConversation = useCallback((id: string) => {
    setSelectedId(id);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('conversation', id);
      return next;
    });
  }, [setSearchParams]);

  const clearSelectedConversation = useCallback(() => {
    setSelectedId(null);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('conversation');
      return next;
    });
  }, [setSearchParams]);

  const didInitRef = useRef(false);
  const fetchInFlightRef = useRef(false);
  const fetchQueuedRef = useRef(false);
  const queuedLoadingRef = useRef(false);
  const fetchVersionRef = useRef(0);

  const fetchConversations = useCallback(async (showLoading = true) => {
    const request = ++fetchVersionRef.current;
    if (fetchInFlightRef.current) {
      fetchQueuedRef.current = true;
      queuedLoadingRef.current ||= showLoading;
      return;
    }
    fetchInFlightRef.current = true;
    if (showLoading) setLoading(true);
    try {
      const res = await apiFetch('/api/conversations', { method: 'GET' });
      const data = (await res.json()) as { conversations?: ApiConversation[] };
      if (request !== fetchVersionRef.current) return;
      if (res.ok && Array.isArray(data.conversations)) {
        setConversations(data.conversations);
        setLoadError('');
        // Só seleciona automaticamente na carga inicial da tela.
        if (!didInitRef.current) {
          const firstOpen = data.conversations.find((c) => c.status !== 'encerrado');
          const desktopLayout = window.matchMedia('(min-width: 768px)').matches;
          if (!selectedIdRef.current && firstOpen && desktopLayout) {
            setSelectedId(firstOpen.id);
          }
          didInitRef.current = true;
        }
      } else {
        setLoadError('Não foi possível atualizar as conversas. Tente novamente.');
      }
    } catch {
      if (request !== fetchVersionRef.current) return;
      setLoadError('Não foi possível atualizar as conversas. Verifique sua conexão.');
    } finally {
      fetchInFlightRef.current = false;
      const shouldRefreshAgain = fetchQueuedRef.current;
      const nextShowLoading = showLoading || queuedLoadingRef.current;
      fetchQueuedRef.current = false;
      queuedLoadingRef.current = false;
      if (request === fetchVersionRef.current && showLoading) setLoading(false);
      if (shouldRefreshAgain) void fetchConversations(nextShowLoading);
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
      clearSelectedConversation();
    }
    setClosing(true);
    setOperationError('');
    try {
      await apiPost(`/api/conversations/${id}/close`, { reason: 'Finalizado pelo atendente', sendSurvey });
      // Reload em background, sem travar o botão.
      void fetchConversations(false);
    } catch {
      setOperationError('Não foi possível finalizar o chamado. A conversa foi recarregada para evitar perda de estado.');
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
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
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

  const handleMessageInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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
      const base = getApiBaseUrl();
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

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = linkUrl.trim();
    if (!selectedId || !url) return;
    const text = linkTitle.trim() ? `*${linkTitle.trim()}*\n${url}` : url;
    setLinkModalOpen(false);
    setLinkUrl('');
    setLinkTitle('');
    const optId = `opt-${Date.now()}`;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: [
                ...(c.messages || []),
                { id: optId, content: text, direction: 'outbound' as const, createdAt: new Date().toISOString() },
              ],
            }
          : c,
      ),
    );
    setSendError('');
    setSending(true);
    try {
      await apiPost(`/api/conversations/${selectedId}/messages`, { content: text, withSignature: signatureOn });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Nao foi possivel enviar o link.');
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? { ...c, messages: (c.messages || []).filter((m) => m.id !== optId) }
            : c,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const fetchPdfBlob = async (message: ApiMessage, download = false) => {
    if (!selectedId) throw new Error('Selecione o atendimento novamente.');
    const params = new URLSearchParams({
      conversationId: selectedId,
      messageId: message.id,
    });
    if (download) params.set('download', '1');

    const response = await apiFetch(`/api/media/pdf?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/pdf' },
    });
    if (response.ok) return validatedPdfBlob(response);

    const contentType = String(response.headers.get('content-type') || '');
    const backendRouteNotDeployed =
      response.status === 404 && contentType.includes('text/html');
    if (backendRouteNotDeployed && isTrustedPdfFallbackUrl(message.mediaUrl)) {
      const fallback = await fetch(String(message.mediaUrl), {
        method: 'GET',
        headers: { Accept: 'application/pdf' },
      });
      if (fallback.ok) return validatedPdfBlob(fallback);
    }

    const data = contentType.includes('application/json')
      ? ((await response.json().catch(() => ({}))) as { error?: string })
      : {};
    throw new Error(data.error || 'Não foi possível carregar o PDF.');
  };

  const openPdf = async (message: ApiMessage) => {
    if (!selectedId || !message.id || openingPdfId || downloadingPdfId) return;
    // Abrir a aba durante o clique evita que o bloqueador de pop-ups recuse a
    // navegação depois do fetch assíncrono autenticado.
    const pdfTab = window.open('', '_blank');
    if (!pdfTab) {
      setSendError('O navegador bloqueou a nova aba. Permita pop-ups ou use “Baixar”.');
      return;
    }
    pdfTab.opener = null;
    pdfTab.document.title = 'Carregando PDF…';
    const loadingMessage = pdfTab.document.createElement('p');
    loadingMessage.textContent = 'Carregando PDF…';
    loadingMessage.style.fontFamily = 'sans-serif';
    loadingMessage.style.padding = '24px';
    pdfTab.document.body.appendChild(loadingMessage);

    setOpeningPdfId(message.id);
    setSendError('');
    try {
      const blob = await fetchPdfBlob(message);
      const url = URL.createObjectURL(blob);
      pdfObjectUrlsRef.current.add(url);
      pdfTab.location.replace(url);
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        pdfObjectUrlsRef.current.delete(url);
      }, 5 * 60_000);
    } catch (error) {
      pdfTab.close();
      setSendError(error instanceof Error ? error.message : 'Não foi possível abrir o PDF.');
    } finally {
      setOpeningPdfId(null);
    }
  };

  const downloadPdf = async (message: ApiMessage) => {
    if (!selectedId || !message.id || openingPdfId || downloadingPdfId) return;
    setDownloadingPdfId(message.id);
    setSendError('');
    try {
      const blob = await fetchPdfBlob(message, true);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = pdfDownloadName(message);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.');
    } finally {
      setDownloadingPdfId(null);
    }
  };

  useEffect(() => () => {
    for (const url of pdfObjectUrlsRef.current) URL.revokeObjectURL(url);
    pdfObjectUrlsRef.current.clear();
  }, []);

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const isAllowed = Boolean(file && (file.type.startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name)));
    if (!file || !selectedId || !isAllowed || uploadingAttachment) {
      if (file && !isAllowed) setSendError('Envie uma imagem ou um arquivo PDF.');
      e.target.value = '';
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      setSendError('O anexo deve ter no máximo 16 MB.');
      e.target.value = '';
      return;
    }
    setUploadingAttachment(true);
    e.target.value = '';
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('withSignature', String(signatureOn));
      const res = await apiFetch(`/api/conversations/${selectedId}/messages/upload`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        setSendError('');
        await fetchConversations(false);
      } else {
        const data = await res.json().catch(() => ({}));
        const msg = (data as { error?: string }).error || 'Erro ao enviar anexo';
        setSendError(msg);
      }
    } catch {
      setSendError('Falha ao enviar anexo. Verifique a conexão do WhatsApp.');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleMessageKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showQuickReplies || !quickReplyOpen || filteredQuickReplies.length === 0) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setQuickReplyIndex((i) => (i + 1) % filteredQuickReplies.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setQuickReplyIndex((i) => (i - 1 + filteredQuickReplies.length) % filteredQuickReplies.length);
    } else if (e.key === 'Enter' && !e.shiftKey && filteredQuickReplies[quickReplyIndex]) {
      e.preventDefault();
      handleQuickReplySelect(filteredQuickReplies[quickReplyIndex].content);
    } else if (e.key === 'Escape') {
      setQuickReplyOpen(false);
    }
  };

  // "Abertas" precisa conter todo ticket que não foi encerrado. 'pendente_cliente'
  // era omitido aqui e também não entra em "Resolvidos" (só 'encerrado'), então essas
  // conversas não apareciam em lugar nenhum: um cliente parado na triagem ficava
  // invisível para a equipe inteira, sem ninguém saber que ele existia.
  const openStatuses: ConversationStatus[] = ['aguardando', 'em_atendimento', 'pendente_cliente'];
  const lastMessage = (c: ApiConversation) => {
    const msgs = [...(c.messages || [])].sort(
      (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
    );
    return msgs[msgs.length - 1];
  };
  const normalizedListSearch = listSearch.trim().toLowerCase();
  const filtered =
    (tabAbertas === 'abertas'
      ? conversations
          .filter((c) => openStatuses.includes(c.status))
          .filter((c) => (statusFilter ? c.status === statusFilter : true))
      : conversations.filter((c) => c.status === 'encerrado'))
      .filter((c) => {
        if (!normalizedListSearch) return true;
        const last = lastMessage(c);
        return [c.contact?.name, c.contact?.phoneNumber, c.queue?.name, last?.content, c.id]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedListSearch));
      });
  const selected = conversations.find((c) => c.id === selectedId);
  const countAtendendo = conversations.filter((c) => c.status === 'em_atendimento').length;
  const countAguardando = conversations.filter((c) => c.status === 'aguardando').length;
  const countTriagem = conversations.filter((c) => c.status === 'pendente_cliente').length;

  useEffect(() => {
    const conversationFromUrl = searchParams.get('conversation');
    if (conversationFromUrl) {
      setSelectedId(conversationFromUrl);
    }
  }, [searchParams]);

  useEffect(() => {
    setSendError('');
  }, [selectedId]);

  // O padrão vem da configuração da loja; falha na leitura mantém o comportamento
  // histórico (assinando), para não mudar o que sai no WhatsApp por causa de um erro.
  useEffect(() => {
    let active = true;
    apiFetch('/api/settings/agent-signature')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { agentSignatureEnabled?: boolean } | null) => {
        if (
          active &&
          !signatureTouchedRef.current &&
          storedSignature === null &&
          data &&
          typeof data.agentSignatureEnabled === 'boolean'
        ) {
          setSignatureOn(data.agentSignatureEnabled);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [storedSignature]);

  // Na aba Abertas, não manter conversa encerrada selecionada — só em Resolvidos
  useEffect(() => {
    if (tabAbertas === 'abertas' && selected?.status === 'encerrado') {
      clearSelectedConversation();
    }
  }, [clearSelectedConversation, tabAbertas, selected?.id, selected?.status]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedId, selected?.messages?.length]);

  // A permissão é pedida por SystemNotifications, a partir de um clique. Pedir aqui no
  // carregamento fazia o navegador descartar o pedido sem mostrar nada ao usuário.

  // Se o usuário trocar de conversa enquanto estiver "Finalizando...",
  // garantimos que o estado de loading de fechamento não fique preso.
  useEffect(() => {
    setClosing(false);
  }, [selectedId]);

  useEffect(() => {
    fetchConversations(true);
    const socket = io(getSocketUrl(), {
      path: '/socket.io',
      withCredentials: true,
      // O cookie é third-party e o celular o descarta; sem o token aqui o tempo real
      // ficaria indisponível justamente onde o atendimento acontece na rua.
      auth: { token: getAccessToken() || undefined },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      timeout: 10000,
    });
    socketRef.current = socket;
    setSocketStatus('connecting');
    socket.on('conversation.created', () => fetchConversations(false));
    socket.on('conversation.updated', () => fetchConversations(false));
    // O alerta de nova mensagem vive em SystemNotifications, que roda em toda tela do
    // painel. Aqui só recarregamos a lista: notificar nos dois lugares duplicaria o
    // aviso, e o antigo só disparava com a aba oculta.
    socket.on('message.created', () => {
      fetchConversations(false);
    });
    socket.on('typing', (payload: { conversationId: string; userName: string; isTyping: boolean }) => {
      if (payload.conversationId !== selectedIdRef.current) return;
      setTypingAgent(payload.isTyping ? { name: payload.userName } : null);
    });
    socket.on('connect', () => { setSocketStatus('connected'); void fetchConversations(false); });
    socket.on('reconnect_attempt', () => setSocketStatus('reconnecting'));
    socket.on('disconnect', () => setSocketStatus('offline'));
    socket.on('connect_error', () => setSocketStatus('offline'));
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
    setOperationError('');
    try {
      await apiPost(`/api/conversations/${selectedId}/assign`, {});
      // Realtime + otimismo já atualizam; não bloquear a UI esperando reload completo.
      void fetchConversations(false);
    } catch {
      setOperationError('Não foi possível assumir este atendimento. Atualize a lista e tente novamente.');
    } finally {
      setAssigning(false);
    }
  };

  const handleAssignFromList = async (id: string) => {
    setAssigning(true);
    setOperationError('');
    const previousSelected = selectedId;
    selectConversation(id);
    // Otimismo: marca como em_atendimento imediatamente
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'em_atendimento' as ConversationStatus } : c)),
    );
    try {
      await apiPost(`/api/conversations/${id}/assign`, {});
      void fetchConversations(false);
    } catch {
      setOperationError('Não foi possível assumir este atendimento. O estado foi restaurado.');
      // Reverte em caso de erro
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'aguardando' as ConversationStatus } : c)),
      );
      if (previousSelected) selectConversation(previousSelected);
      else clearSelectedConversation();
    } finally {
      setAssigning(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = messageInput.trim();
    if (!selectedId || !text || sending) return;
    setMessageInput('');
    setSendError('');
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
      await apiPost(`/api/conversations/${selectedId}/messages`, { content: text, withSignature: signatureOn });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Nao foi possivel enviar a mensagem.');
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

  return (
    <div className="flex flex-1 overflow-hidden min-h-0 min-w-0 bg-slate-50 dark:bg-slate-800/95 transition-colors">
      <div className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-80 lg:w-[22rem] flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 shrink-0 min-h-0 overflow-hidden transition-colors`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-blue-600 dark:text-blue-400">Operação</p><h1 className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">Caixa de entrada</h1><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Acompanhe e distribua os atendimentos.</p></div>
            <button type="button" onClick={() => setNewChatOpen(true)} className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-blue-700" title="Iniciar conversa com um número novo">+ Nova conversa</button>
            <button type="button" onClick={() => void fetchConversations(false)} className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800" title="Atualizar conversas" aria-label="Atualizar conversas"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M15.312 5.312a8 8 0 1 0 1.883 8.237.75.75 0 0 0-1.436-.433A6.5 6.5 0 1 1 14.25 7.25V5.5a.75.75 0 0 0-1.5 0V9a.75.75 0 0 0 .75.75H17a.75.75 0 0 0 0-1.5h-1.688V5.312Z" clipRule="evenodd" /></svg></button>
          </div>
          <label className="relative block mb-4"><span className="sr-only">Pesquisar conversas</span><input value={listSearch} onChange={(event) => setListSearch(event.target.value)} placeholder="Buscar por nome, telefone ou mensagem" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 py-2.5 pl-9 pr-3 text-xs text-slate-800 dark:text-white outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"><path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.447 9.785l2.634 2.634a.75.75 0 1 0 1.06-1.06l-2.633-2.634A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" /></svg></label>
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
              {filtered.length} {tabAbertas === 'abertas' ? 'abertas' : 'resolvidas'}
            </button>
            <button type="button" onClick={() => setListSearch('')} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-white transition-colors" aria-label="Limpar busca" title="Limpar busca">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.206A8.217 8.217 0 005.25 9.75V9z" clipRule="evenodd" />
              </svg>
            </button>
            <span className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium ${socketStatus === 'connected' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200' : socketStatus === 'reconnecting' || socketStatus === 'connecting' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-100' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-200'}`}><span className={`h-2 w-2 shrink-0 rounded-full ${socketStatus === 'connected' ? 'bg-emerald-500' : socketStatus === 'offline' ? 'bg-rose-500' : 'bg-amber-500'}`} />{socketStatus === 'connected' ? 'Atualização em tempo real' : socketStatus === 'reconnecting' ? 'Reconectando atualização' : socketStatus === 'connecting' ? 'Conectando atualização' : 'Atualização indisponível'}</span>
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
            {/* Torna visível quem está parado na triagem, em vez de deixar o ticket sem lugar na tela. */}
            <button
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === 'pendente_cliente' ? null : 'pendente_cliente'))}
              className={`flex items-center gap-2 text-xs font-bold rounded-lg px-3 py-2 transition-all ${
                statusFilter === 'pendente_cliente'
                  ? 'bg-amber-600 text-white shadow-md ring-2 ring-amber-400/50 dark:ring-amber-500/50'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
              }`}
              title={statusFilter === 'pendente_cliente' ? 'Mostrar todos' : 'Filtrar por triagem com o bot'}
            >
              <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500/90 px-1.5 text-[10px] text-white">{countTriagem}</span>
              EM TRIAGEM
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700/80">
          {loadError && <div role="alert" className="m-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"><div className="flex items-center justify-between gap-2"><span>{loadError}</span><button type="button" onClick={() => void fetchConversations(true)} className="font-bold underline">Tentar novamente</button></div></div>}
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
                  data-conversation-id={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectConversation(c.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectConversation(c.id);
                    }
                  }}
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
                      {(c.status === 'aguardando' || c.status === 'pendente_cliente') && (
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
                      {c.status !== 'encerrado' && (
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
                    {c.contact?.avatarUrl ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setAvatarPreview({
                            url: c.contact.avatarUrl!,
                            name: c.contact.name || c.contact.phoneNumber || 'Contato',
                          });
                        }}
                        aria-label={`Ampliar foto de ${c.contact.name || c.contact.phoneNumber || 'Contato'}`}
                        title="Ampliar foto"
                        className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-slate-200 transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-blue-500/30 dark:bg-slate-700"
                      >
                        <img
                          src={c.contact.avatarUrl}
                          alt={c.contact.name || c.contact.phoneNumber || 'Contato'}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-sm font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        {(c.contact?.name || c.contact?.phoneNumber || '?')[0].toUpperCase()}
                      </div>
                    )}
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

      <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-slate-100 dark:bg-slate-800/50 min-w-0 min-h-0 overflow-hidden transition-colors`}>
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
            <header className="px-2.5 sm:px-8 py-3 sm:py-5 bg-white dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 shrink-0 transition-colors">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={clearSelectedConversation}
                  aria-label="Voltar para conversas"
                  className="md:hidden shrink-0 p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.56l3.22 3.22a.75.75 0 11-1.06 1.06l-4.5-4.5a.75.75 0 010-1.06l4.5-4.5a.75.75 0 011.06 1.06L5.56 9.25h10.69A.75.75 0 0117 10z" clipRule="evenodd" />
                  </svg>
                </button>
                {selected.contact?.avatarUrl ? (
                  <button
                    type="button"
                    onClick={() => setAvatarPreview({
                      url: selected.contact.avatarUrl!,
                      name: selected.contact.name || selected.contact.phoneNumber || 'Contato',
                    })}
                    aria-label={`Ampliar foto de ${selected.contact.name || selected.contact.phoneNumber || 'Contato'}`}
                    title="Ampliar foto"
                    className="flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-slate-200 transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-blue-500/30 sm:h-10 sm:w-10 dark:bg-slate-700"
                  >
                    <img
                      src={selected.contact.avatarUrl}
                      alt={selected.contact.name || selected.contact.phoneNumber || 'Contato'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-sm font-bold text-slate-600 sm:h-10 sm:w-10 dark:bg-slate-700 dark:text-slate-300">
                    {(selected.contact?.name || selected.contact?.phoneNumber || '?')[0].toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold text-slate-800 dark:text-slate-100 truncate">
                    {selected.contact?.name || selected.contact?.phoneNumber || 'Contato'}
                  </h2>
                  <div className="min-w-0 text-xs">
                    <p className="text-slate-500 dark:text-slate-400 truncate">{selected.contact?.phoneNumber}</p>
                    {selected.ticket && (selected.ticket as { assignee?: { name: string } }).assignee?.name && (
                      <span className="block text-xs text-blue-600 dark:text-blue-400 font-medium truncate">
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
                  aria-label="Editar contato"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {(selected.status === 'aguardando' || selected.status === 'pendente_cliente') && (
                  <button
                    type="button"
                    onClick={handleAssign}
                    disabled={assigning}
                    className="bg-blue-600 text-white px-3 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {assigning ? 'Assumindo...' : <><span className="sm:hidden">Puxar</span><span className="hidden sm:inline">Puxar Atendimento</span></>}
                  </button>
                )}
                {selected.status === 'em_atendimento' && (
                  <button
                    type="button"
                    onClick={handleCloseConversation}
                    disabled={closing}
                    className="bg-slate-700 text-white px-3 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
                  >
                    {closing ? 'Finalizando...' : <><span className="sm:hidden">Finalizar</span><span className="hidden sm:inline">Finalizar chamado</span></>}
                  </button>
                )}
              </div>
            </header>
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 space-y-3 min-h-0 flex flex-col">
              {[...(selected.messages || [])].sort(
                (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
              ).map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] sm:max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
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
                        href={m.cloudinaryPublicId ? getApiUrl(`/api/media/signed?publicId=${encodeURIComponent(m.cloudinaryPublicId)}&conversationId=${encodeURIComponent(selected.id)}`) : m.mediaUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={m.cloudinaryPublicId ? getApiUrl(`/api/media/signed?publicId=${encodeURIComponent(m.cloudinaryPublicId)}&conversationId=${encodeURIComponent(selected.id)}`) : m.mediaUrl || ''}
                          alt=""
                          className="max-w-full rounded-lg max-h-64 object-contain"
                        />
                      </a>
                    ) : m.type === 'document' && m.mediaUrl ? (
                      <div className="min-w-[220px] max-w-sm">
                        {m.withSignature && m.authorName && (
                          <span className="mb-2 block font-semibold">{m.authorName}:</span>
                        )}
                        <div className={`flex items-center gap-3 rounded-xl border p-3 ${
                          m.direction === 'outbound'
                            ? 'border-blue-400/70 bg-blue-700/30'
                            : 'border-slate-200 bg-slate-50 dark:border-slate-500 dark:bg-slate-800'
                        }`}>
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-black ${
                            m.direction === 'outbound'
                              ? 'bg-white/15 text-white'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                          }`} aria-hidden="true">{isPdfMessage(m) ? 'PDF' : 'DOC'}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold" title={documentTitle(m)}>{documentTitle(m)}</p>
                            <p className={`text-xs ${m.direction === 'outbound' ? 'text-blue-100' : 'text-slate-500 dark:text-slate-300'}`}>
                              {isPdfMessage(m) ? 'Arquivo PDF' : (m.mimeType || 'Arquivo')}
                            </p>
                          </div>
                          {isPdfMessage(m) ? (
                            <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                              <button
                                type="button"
                                onClick={() => void openPdf(m)}
                                disabled={openingPdfId === m.id || downloadingPdfId === m.id}
                                className={`rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-60 ${
                                  m.direction === 'outbound'
                                    ? 'bg-white text-blue-700 hover:bg-blue-50'
                                    : 'bg-blue-600 text-white hover:bg-blue-700'
                                }`}
                                aria-label={`Abrir PDF: ${documentTitle(m)}`}
                              >
                                {openingPdfId === m.id ? 'Abrindo…' : 'Abrir'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void downloadPdf(m)}
                                disabled={openingPdfId === m.id || downloadingPdfId === m.id}
                                className={`rounded-lg border px-3 py-2 text-xs font-bold transition disabled:opacity-60 ${
                                  m.direction === 'outbound'
                                    ? 'border-white/70 text-white hover:bg-white/10'
                                    : 'border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-950/40'
                                }`}
                                aria-label={`Baixar PDF: ${documentTitle(m)}`}
                              >
                                {downloadingPdfId === m.id ? 'Baixando…' : 'Baixar'}
                              </button>
                            </div>
                          ) : (
                            <a
                              href={m.mediaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold ${
                                m.direction === 'outbound'
                                  ? 'bg-white text-blue-700'
                                  : 'bg-blue-600 text-white'
                              }`}
                            >
                              Baixar
                            </a>
                          )}
                        </div>
                      </div>
                    ) : m.withSignature && m.authorName ? (
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
              <form onSubmit={handleSendMessage} className="p-2 sm:p-4 bg-white dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-700 shrink-0 transition-colors">
                {operationError && <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">{operationError}</div>}
                {sendError && (
                  <div role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                    {sendError}
                  </div>
                )}
                <div className="flex gap-1.5 sm:gap-2 relative">
                  <label aria-label="Enviar imagem ou PDF" className="shrink-0 flex items-center justify-center w-10 h-11 sm:w-12 sm:h-12 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50 text-slate-500 dark:text-slate-400" title="Enviar imagem ou PDF (até 16 MB)">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf"
                      onChange={handleAttachmentUpload}
                      disabled={sending || uploadingAttachment}
                      className="hidden"
                    />
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-slate-500">
                      <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-3.69l-2.97-2.97a.75.75 0 00-1.06 0l-1.5 1.5a.75.75 0 01-1.06 0l-2.44-2.44a.75.75 0 00-1.06 0l-3.09 3.1z" clipRule="evenodd" />
                    </svg>
                  </label>
                  <button
                    type="button"
                    onClick={() => setLinkModalOpen(true)}
                    disabled={sending}
                    title="Anexar link de documento"
                    aria-label="Anexar link de documento"
                    className="shrink-0 flex items-center justify-center w-10 h-11 sm:w-12 sm:h-12 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-500 dark:text-slate-400"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z" />
                      <path d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z" />
                    </svg>
                  </button>
                  {/* Liga/desliga o "Nome:" antes da mensagem. Vale só para os envios
                      deste atendente; o padrão continua vindo das configurações da loja. */}
                  <button
                    type="button"
                    onClick={toggleSignature}
                    disabled={sending}
                    role="switch"
                    aria-checked={signatureOn}
                    title={signatureOn ? 'Assinatura ligada: o cliente vê seu nome antes da mensagem' : 'Assinatura desligada: o cliente vê só o texto'}
                    aria-label="Alternar assinatura com o nome do atendente"
                    className={`shrink-0 flex items-center justify-center w-10 h-11 sm:w-12 sm:h-12 rounded-xl border disabled:opacity-50 ${
                      signatureOn
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                    </svg>
                  </button>
                  <div className="flex-1 relative">
                    <textarea
                      ref={messageInputRef}
                      value={messageInput}
                      onChange={handleMessageInputChange}
                      onBlur={handleMessageInputBlur}
                      onKeyDown={handleMessageKeyDown}
                      placeholder="Mensagem... (Enter envia • Shift+Enter quebra a linha)"
                      aria-label="Mensagem para o contato"
                      rows={1}
                      className="w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
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
                    className="mavo-button-primary min-h-11 px-4 sm:px-6"
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

        {newChatOpen && (
          <StartConversationDialog
            onClose={() => setNewChatOpen(false)}
            onStarted={(conversationId) => { void fetchConversations(true); setSelectedId(conversationId); }}
          />
        )}

        {avatarPreview && (
          <AvatarPreviewDialog
            avatarUrl={avatarPreview.url}
            contactName={avatarPreview.name}
            onClose={() => setAvatarPreview(null)}
          />
        )}

        {linkModalOpen && (
          <Dialog title="Anexar link de documento" description="O link será enviado ao contato como uma mensagem do atendimento." onClose={() => { if (!sending) { setLinkModalOpen(false); setLinkUrl(''); setLinkTitle(''); } }}>
              <form onSubmit={handleSendLink} className="space-y-3 p-6">
                <div>
                  <label htmlFor="document-link-url" className="mb-1 block text-xs font-bold uppercase text-slate-500">URL do documento *</label>
                  <input
                    id="document-link-url"
                    data-autofocus
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    required
                    autoFocus
                    placeholder="https://docs.google.com/..."
                    className="mavo-field"
                  />
                </div>
                <div>
                  <label htmlFor="document-link-title" className="mb-1 block text-xs font-bold uppercase text-slate-500">Título (opcional)</label>
                  <input
                    id="document-link-title"
                    type="text"
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    placeholder="Ex: Proposta comercial"
                    className="mavo-field"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => { setLinkModalOpen(false); setLinkUrl(''); setLinkTitle(''); }}
                    disabled={sending}
                    className="mavo-button-secondary"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={sending || !linkUrl.trim()}
                    className="mavo-button-primary"
                  >
                    {sending ? 'Enviando...' : 'Enviar link'}
                  </button>
                </div>
              </form>
          </Dialog>
        )}

        {editContactOpen && selected?.contact && (
          <Dialog title="Editar contato" description="Alterações são aplicadas somente ao contato desta organização." onClose={() => { if (!savingContact) setEditContactOpen(false); }}>
              <form onSubmit={handleSaveContact} className="space-y-4 p-6">
                <div>
                  <label htmlFor="edit-contact-name" className="mb-1 block text-xs font-bold uppercase text-slate-500">Nome</label>
                  <input
                    id="edit-contact-name"
                    data-autofocus
                    type="text"
                    value={editContactName}
                    onChange={(e) => setEditContactName(e.target.value)}
                    className="mavo-field"
                    placeholder="Nome do contato"
                    disabled={savingContact}
                  />
                </div>
                <div>
                  <label htmlFor="edit-contact-phone" className="mb-1 block text-xs font-bold uppercase text-slate-500">Telefone (WhatsApp)</label>
                  <input
                    id="edit-contact-phone"
                    type="text"
                    value={editContactPhone}
                    onChange={(e) => setEditContactPhone(e.target.value)}
                    className="mavo-field"
                    placeholder="whatsapp:+5562999999999"
                    disabled={savingContact}
                  />
                </div>
                {editContactError && (
                  <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-300">{editContactError}</p>
                )}
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => !savingContact && setEditContactOpen(false)}
                    disabled={savingContact}
                    className="mavo-button-secondary"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingContact || (!editContactName.trim() && !editContactPhone.trim())}
                    className="mavo-button-primary"
                  >
                    {savingContact ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
          </Dialog>
        )}
      </div>
    </div>
  );
};

export default InboxConversations;
