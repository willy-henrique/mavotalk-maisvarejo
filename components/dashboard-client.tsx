"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { io, Socket } from "socket.io-client";
import { Icon, MavoBrand } from "@/components/mavo-brand";
import type { Conversation, SessionUser } from "@/types";

type Metrics = {
  totalAguardando: number;
  totalAtendimento: number;
  totalEncerrado: number;
  firstResponseAverageMinutes: number | null;
  volumeByDemand: Array<{ queueName: string; colorHex: string; total: number }>;
};

type WhatsappState = {
  status: "idle" | "initializing" | "qr" | "ready" | "disconnected" | "error";
  qrDataUrl: string | null;
  lastError: string | null;
  connectedPhone: string | null;
};

type StatusFilter = "todos" | Conversation["status"];

const statusLabels: Record<Conversation["status"], string> = {
  aguardando: "Aguardando",
  em_atendimento: "Em atendimento",
  pendente_cliente: "Aguardando cliente",
  encerrado: "Encerrado",
};

const channelLabels: Record<WhatsappState["status"], string> = {
  idle: "Não iniciado",
  initializing: "Conectando...",
  qr: "Aguardando leitura",
  ready: "WhatsApp online",
  disconnected: "Desconectado",
  error: "Falha na conexão",
};

let socket: Socket | null = null;

function getInitials(name: string | null, phone: string) {
  if (!name?.trim()) return phone.slice(-2);
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return phone;
}

function messageTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function DashboardClient() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [closeReason, setCloseReason] = useState("Atendimento resolvido");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [provider, setProvider] = useState<string>("twilio");
  const [waState, setWaState] = useState<WhatsappState | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unauthorizedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId],
  );

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return conversations.filter((conversation) => {
      const matchesStatus = statusFilter === "todos" || conversation.status === statusFilter;
      const haystack = [
        conversation.contact.name,
        conversation.contact.phoneNumber,
        conversation.queue?.name,
        conversation.messages.at(-1)?.content,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR");
      return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [conversations, query, statusFilter]);

  const refreshAll = useCallback(async (showIndicator = false) => {
    if (unauthorizedRef.current) return;
    if (showIndicator) setRefreshing(true);

    try {
      const [conversationsResponse, metricsResponse, whatsappResponse, meResponse] = await Promise.all([
        fetch("/api/conversations", { cache: "no-store" }),
        fetch("/api/dashboard/metrics", { cache: "no-store" }),
        fetch("/api/whatsapp/status", { cache: "no-store" }),
        fetch("/api/me", { cache: "no-store" }),
      ]);

      if (
        conversationsResponse.status === 401 ||
        metricsResponse.status === 401 ||
        whatsappResponse.status === 401
      ) {
        unauthorizedRef.current = true;
        window.location.href = "/login";
        return;
      }

      if (conversationsResponse.ok) {
        const payload = await conversationsResponse.json();
        setConversations(payload.conversations);
        setSelectedId((previous) => previous || payload.conversations[0]?.id || null);
      }

      if (metricsResponse.ok) {
        const payload = await metricsResponse.json();
        setMetrics(payload.metrics);
      }

      if (whatsappResponse.ok) {
        const payload = await whatsappResponse.json();
        setProvider(payload.provider);
        setWaState(payload.state);
      }

      if (meResponse.ok) {
        const payload = await meResponse.json();
        setUser(payload.user);
      }

      if (!conversationsResponse.ok || !metricsResponse.ok) {
        setFeedback({ type: "error", text: "Parte dos dados da operação não pôde ser carregada. Tente atualizar a página." });
      }
    } catch {
      setFeedback({ type: "error", text: "Não foi possível atualizar a operação. Tentaremos novamente em instantes." });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const scheduleRefresh = useCallback(
    (delayMs = 300) => {
      if (refreshTimeoutRef.current) return;
      refreshTimeoutRef.current = setTimeout(() => {
        refreshTimeoutRef.current = null;
        void refreshAll();
      }, delayMs);
    },
    [refreshAll],
  );

  useEffect(() => {
    void refreshAll();

    socket = io({ path: "/socket.io" });
    socket.on("conversation.created", () => scheduleRefresh());
    socket.on("conversation.updated", () => scheduleRefresh());
    socket.on("message.created", (payload?: { conversationId?: string; message?: Conversation["messages"][number] }) => {
      if (!payload?.conversationId || !payload.message) {
        scheduleRefresh();
        return;
      }

      const conversationId = payload.conversationId;
      const incomingMessage = payload.message;

      setConversations((previous) =>
        previous.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          const messages = [...conversation.messages, incomingMessage].slice(-50);
          return {
            ...conversation,
            messages,
            updatedAt: incomingMessage.createdAt || new Date().toISOString(),
          };
        }),
      );
    });
    socket.on("sla.breached", () => scheduleRefresh());

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      socket?.disconnect();
      socket = null;
    };
  }, [refreshAll, scheduleRefresh]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [selectedId, selectedConversation?.messages.length]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timeout);
  }, [feedback]);

  async function performAction(key: string, action: () => Promise<Response>, successMessage: string) {
    if (actionBusy) return false;
    setActionBusy(key);
    setFeedback(null);
    try {
      const response = await action();
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "A ação não pôde ser concluída.");
      }
      setFeedback({ type: "success", text: successMessage });
      return true;
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "A ação não pôde ser concluída." });
      return false;
    } finally {
      setActionBusy(null);
    }
  }

  async function assignConversation(conversationId: string) {
    const succeeded = await performAction(
      "assign",
      () => fetch(`/api/conversations/${conversationId}/assign`, { method: "POST" }),
      "Conversa atribuída a você.",
    );
    if (succeeded) await refreshAll();
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedConversation || !message.trim()) return;
    const content = message.trim();

    const succeeded = await performAction(
      "send",
      () =>
        fetch(`/api/conversations/${selectedConversation.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }),
      "Mensagem enviada.",
    );

    if (succeeded) {
      setMessage("");
      await refreshAll();
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function closeConversation() {
    if (!selectedConversation || !closeReason.trim()) return;

    const succeeded = await performAction(
      "close",
      () =>
        fetch(`/api/conversations/${selectedConversation.id}/close`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: closeReason.trim() }),
        }),
      "Atendimento encerrado com sucesso.",
    );

    if (succeeded) {
      setSelectedId(null);
      setMobileChatOpen(false);
      await refreshAll();
    }
  }

  async function connectWhatsapp() {
    const succeeded = await performAction(
      "connect",
      () => fetch("/api/whatsapp/connect", { method: "POST" }),
      "Conexão iniciada. Leia o QR Code quando ele aparecer.",
    );
    if (succeeded) await refreshAll();
  }

  async function disconnectWhatsapp() {
    const succeeded = await performAction(
      "disconnect",
      () => fetch("/api/whatsapp/disconnect", { method: "POST" }),
      "WhatsApp desconectado.",
    );
    if (succeeded) await refreshAll();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (loading) {
    return (
      <div className="app-loader">
        <MavoBrand />
        <span className="loader-orbit" />
        <p>Preparando sua central de conversas...</p>
      </div>
    );
  }

  const channelStatus = provider === "unofficial" ? waState?.status || "idle" : "ready";
  const firstName = user?.name?.split(" ")[0] || "Equipe";

  return (
    <div className="dashboard-app">
      <aside className="app-sidebar">
        <MavoBrand inverse />

        <nav className="main-nav" aria-label="Navegação principal">
          <span className="nav-label">Operação</span>
          <a href="/dashboard" className="nav-item active" aria-current="page">
            <Icon name="inbox" />
            <span>Conversas</span>
            {(metrics?.totalAguardando || 0) > 0 ? <em>{metrics?.totalAguardando}</em> : null}
          </a>
          <a href="/dashboard/queues" className="nav-item">
            <Icon name="queue" />
            <span>Demandas e filas</span>
          </a>
        </nav>

        <div className="channel-card">
          <div className="channel-card-heading">
            <span className="channel-icon"><Icon name="whatsapp" /></span>
            <div><strong>Canal WhatsApp</strong><small>{provider === "unofficial" ? "Conexão por QR Code" : "Provedor Twilio"}</small></div>
          </div>
          <div className={`channel-state ${channelStatus}`}>
            <span />
            {provider === "unofficial" ? channelLabels[channelStatus] : "Canal disponível"}
          </div>
          {waState?.connectedPhone ? <p className="connected-phone">{formatPhone(waState.connectedPhone)}</p> : null}
          {provider === "unofficial" && waState?.qrDataUrl ? (
            <div className="qr-frame">
              <Image src={waState.qrDataUrl} alt="QR Code para conectar o WhatsApp" width={176} height={176} priority />
              <small>Leia com o WhatsApp do celular</small>
            </div>
          ) : null}
          {provider === "unofficial" ? (
            <div className="channel-actions">
              <button type="button" onClick={connectWhatsapp} disabled={Boolean(actionBusy)}>
                <Icon name="refresh" size={15} /> {channelStatus === "ready" ? "Reconectar" : "Gerar QR"}
              </button>
              {channelStatus === "ready" ? (
                <button type="button" className="icon-only" onClick={disconnectWhatsapp} aria-label="Desconectar WhatsApp" disabled={Boolean(actionBusy)}>
                  <Icon name="power" size={16} />
                </button>
              ) : null}
            </div>
          ) : null}
          {waState?.lastError ? <p className="channel-error">{waState.lastError}</p> : null}
        </div>

        <div className="sidebar-user">
          <span className="user-avatar">{getInitials(user?.name || null, user?.email || "MT")}</span>
          <span><strong>{user?.name || "Usuário Mavo"}</strong><small>{user?.role || "atendente"}</small></span>
          <button type="button" onClick={logout} aria-label="Sair do Mavo Talk" title="Sair">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>

      <main className="dashboard-workspace">
        <header className="workspace-header">
          <div className="mobile-brand"><MavoBrand /></div>
          <div>
            <span className="eyebrow">Visão da operação</span>
            <h1>Olá, {firstName}. <span>Vamos cuidar das conversas?</span></h1>
          </div>
          <div className="workspace-actions">
            <span className="live-indicator"><i /> Atualização em tempo real</span>
            <button type="button" className="refresh-button" onClick={() => void refreshAll(true)} disabled={refreshing}>
              <Icon name="refresh" className={refreshing ? "spinning" : ""} />
              <span>Atualizar</span>
            </button>
          </div>
        </header>

        {feedback ? (
          <div className={`toast-message ${feedback.type}`} role="status">
            <span><Icon name={feedback.type === "success" ? "check" : "close"} size={16} /></span>
            {feedback.text}
            <button type="button" onClick={() => setFeedback(null)} aria-label="Fechar aviso"><Icon name="close" size={15} /></button>
          </div>
        ) : null}

        <section className="metrics-grid" aria-label="Indicadores da operação">
          <article className="metric-card waiting">
            <span className="metric-icon"><Icon name="clock" /></span>
            <div><small>Aguardando</small><strong>{metrics?.totalAguardando ?? 0}</strong><p>na fila agora</p></div>
          </article>
          <article className="metric-card active">
            <span className="metric-icon"><Icon name="headset" /></span>
            <div><small>Em atendimento</small><strong>{metrics?.totalAtendimento ?? 0}</strong><p>conversas ativas</p></div>
          </article>
          <article className="metric-card response">
            <span className="metric-icon"><Icon name="activity" /></span>
            <div><small>Tempo de resposta</small><strong>{metrics?.firstResponseAverageMinutes ?? "—"}<em>{metrics?.firstResponseAverageMinutes != null ? " min" : ""}</em></strong><p>média da equipe</p></div>
          </article>
          <article className="metric-card finished">
            <span className="metric-icon"><Icon name="check" /></span>
            <div><small>Encerrados</small><strong>{metrics?.totalEncerrado ?? 0}</strong><p>atendimentos</p></div>
          </article>
        </section>

        {(metrics?.volumeByDemand.length || 0) > 0 ? (
          <section className="demand-overview" aria-label="Volume por demanda">
            <span className="demand-overview-label">Volume por demanda</span>
            <div>
              {metrics?.volumeByDemand.map((item) => (
                <span key={item.queueName} className="demand-volume-pill">
                  <i style={{ background: item.colorHex }} />
                  {item.queueName}
                  <strong>{item.total}</strong>
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section className={`inbox-workbench ${mobileChatOpen ? "mobile-chat-open" : ""}`}>
          <section className="conversation-list" aria-label="Lista de conversas">
            <div className="conversation-list-header">
              <div><h2>Conversas</h2><span>{filteredConversations.length} de {conversations.length}</span></div>
              <a href="/dashboard/queues" className="small-icon-button" aria-label="Gerenciar demandas" title="Gerenciar demandas">
                <Icon name="queue" />
              </a>
            </div>

            <div className="conversation-search">
              <Icon name="search" size={18} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar nome, telefone ou mensagem"
                aria-label="Buscar conversas"
              />
              {query ? <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca"><Icon name="close" size={15} /></button> : null}
            </div>

            <div className="status-tabs" role="tablist" aria-label="Filtrar por status">
              {(["todos", "aguardando", "em_atendimento", "encerrado"] as StatusFilter[]).map((status) => (
                <button
                  type="button"
                  key={status}
                  className={statusFilter === status ? "active" : ""}
                  onClick={() => setStatusFilter(status)}
                  role="tab"
                  aria-selected={statusFilter === status}
                >
                  {status === "todos" ? "Todas" : status === "em_atendimento" ? "Ativas" : statusLabels[status]}
                </button>
              ))}
            </div>

            <div className="conversation-scroll">
              {filteredConversations.length ? filteredConversations.map((conversation) => {
                const lastMessage = conversation.messages.at(-1);
                const isSelected = conversation.id === selectedId;
                const queueColor = conversation.queue?.colorHex || "#8a94a6";
                const displayName = conversation.contact.name || formatPhone(conversation.contact.phoneNumber);
                const isOverdue = Boolean(
                  conversation.ticket?.firstResponseDueAt &&
                  new Date(conversation.ticket.firstResponseDueAt).getTime() < Date.now() &&
                  conversation.status === "aguardando",
                );

                return (
                  <button
                    type="button"
                    key={conversation.id}
                    className={`conversation-card ${isSelected ? "selected" : ""}`}
                    onClick={() => { setSelectedId(conversation.id); setMobileChatOpen(true); }}
                    aria-pressed={isSelected}
                  >
                    <span className="conversation-avatar" style={{ "--avatar-color": queueColor } as React.CSSProperties}>
                      {getInitials(conversation.contact.name, conversation.contact.phoneNumber)}
                      <i />
                    </span>
                    <span className="conversation-main">
                      <span className="conversation-topline">
                        <strong>{displayName}</strong>
                        <time>{formatDistanceToNow(new Date(conversation.updatedAt), { locale: ptBR, addSuffix: false })}</time>
                      </span>
                      <span className="conversation-preview">{lastMessage?.content || "Conversa iniciada, sem mensagens."}</span>
                      <span className="conversation-meta">
                        <em style={{ "--tag-color": queueColor } as React.CSSProperties}>{conversation.queue?.name || "Sem demanda"}</em>
                        <i className={`status-dot ${conversation.status}`} />
                        <small>{statusLabels[conversation.status]}</small>
                        {isOverdue ? <b><Icon name="clock" size={11} /> SLA</b> : null}
                      </span>
                    </span>
                  </button>
                );
              }) : (
                <div className="empty-list">
                  <span><Icon name="search" size={24} /></span>
                  <strong>Nenhuma conversa encontrada</strong>
                  <p>Ajuste a busca ou escolha outro filtro.</p>
                  <button type="button" onClick={() => { setQuery(""); setStatusFilter("todos"); }}>Limpar filtros</button>
                </div>
              )}
            </div>
          </section>

          <section className="chat-panel" aria-label="Atendimento selecionado">
            {selectedConversation ? (
              <>
                <header className="chat-header">
                  <button type="button" className="mobile-back-button" onClick={() => setMobileChatOpen(false)} aria-label="Voltar para conversas">
                    <Icon name="arrow-left" />
                  </button>
                  <div className="chat-contact">
                    <span className="large-avatar">{getInitials(selectedConversation.contact.name, selectedConversation.contact.phoneNumber)}</span>
                    <div>
                      <h2>{selectedConversation.contact.name || "Contato sem nome"}</h2>
                      <p><Icon name="whatsapp" size={13} /> {formatPhone(selectedConversation.contact.phoneNumber)}</p>
                    </div>
                  </div>
                  <div className="chat-header-context">
                    <span className={`status-badge ${selectedConversation.status}`}><i />{statusLabels[selectedConversation.status]}</span>
                    {selectedConversation.ticket?.assignee ? (
                      <span className="assignee"><Icon name="user" size={14} /> {selectedConversation.ticket.assignee.name}</span>
                    ) : null}
                    {selectedConversation.status !== "encerrado" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => assignConversation(selectedConversation.id)}
                        disabled={Boolean(actionBusy)}
                      >
                        <Icon name="headset" size={16} />
                        {actionBusy === "assign" ? "Atribuindo..." : "Assumir conversa"}
                      </button>
                    ) : null}
                  </div>
                </header>

                <div className="chat-subheader">
                  <span className="queue-context" style={{ "--queue-color": selectedConversation.queue?.colorHex || "#8a94a6" } as React.CSSProperties}>
                    <i /> {selectedConversation.queue?.name || "Demanda não classificada"}
                  </span>
                  <span>Protocolo #{selectedConversation.id.slice(-8).toUpperCase()}</span>
                </div>

                <div className="messages">
                  <div className="message-date"><span>Histórico da conversa</span></div>
                  {selectedConversation.messages.length ? selectedConversation.messages.map((item) => (
                    <div key={item.id} className={`message-row ${item.direction}`}>
                      <div className={`message ${item.direction}`}>
                        {item.type !== "text" ? <small className="message-type">{item.type === "image" ? "Imagem" : "Documento"}</small> : null}
                        <span>{item.content}</span>
                        <time>{messageTime(item.createdAt)} {item.direction === "outbound" ? <Icon name="check" size={13} /> : null}</time>
                      </div>
                    </div>
                  )) : (
                    <div className="empty-chat-history"><Icon name="inbox" size={24} /><span>A conversa ainda não possui mensagens.</span></div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {selectedConversation.status !== "encerrado" ? (
                  <div className="chat-actions-area">
                    <form onSubmit={sendMessage} className="composer">
                      <textarea
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        onKeyDown={handleComposerKeyDown}
                        placeholder="Escreva uma resposta..."
                        rows={1}
                        aria-label="Mensagem para o cliente"
                      />
                      <span className="composer-hint">Enter para enviar · Shift + Enter para quebrar linha</span>
                      <button type="submit" disabled={!message.trim() || Boolean(actionBusy)} aria-label="Enviar mensagem">
                        {actionBusy === "send" ? <span className="button-spinner" /> : <Icon name="send" size={18} />}
                      </button>
                    </form>

                    <div className="resolution-row">
                      <div>
                        <span className="resolution-icon"><Icon name="check" size={16} /></span>
                        <span><strong>Conversa resolvida?</strong><small>Informe o motivo antes de encerrar</small></span>
                      </div>
                      <input
                        value={closeReason}
                        onChange={(event) => setCloseReason(event.target.value)}
                        placeholder="Motivo do encerramento"
                        aria-label="Motivo do encerramento"
                      />
                      <button type="button" onClick={closeConversation} disabled={!closeReason.trim() || Boolean(actionBusy)}>
                        {actionBusy === "close" ? "Encerrando..." : "Encerrar atendimento"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="conversation-closed-banner">
                    <span><Icon name="check" /></span>
                    <div><strong>Atendimento encerrado</strong><small>{selectedConversation.ticket?.closeReason || "Conversa finalizada pela equipe."}</small></div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-chat">
                <div className="empty-chat-illustration"><Icon name="inbox" size={34} /><i /><i /></div>
                <span className="eyebrow">Sua central está pronta</span>
                <h2>Selecione uma conversa</h2>
                <p>Escolha um atendimento ao lado para ver o histórico e responder ao cliente.</p>
              </div>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}
