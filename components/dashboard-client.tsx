/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { io, Socket } from "socket.io-client";
import type { Conversation } from "@/types";

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

let socket: Socket | null = null;

export function DashboardClient() {
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [closeReason, setCloseReason] = useState("Resolvido");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [provider, setProvider] = useState<string>("twilio");
  const [waState, setWaState] = useState<WhatsappState | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId],
  );

  const refreshAll = useCallback(async () => {
    const [conversationsResponse, metricsResponse, whatsappResponse] = await Promise.all([
      fetch("/api/conversations", { cache: "no-store" }),
      fetch("/api/dashboard/metrics", { cache: "no-store" }),
      fetch("/api/whatsapp/status", { cache: "no-store" }),
    ]);

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

    setLoading(false);
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

      setConversations((previous) =>
        previous.map((conversation) => {
          if (conversation.id !== payload.conversationId) return conversation;
          const messages = [...conversation.messages, payload.message].slice(-50);
          return {
            ...conversation,
            messages,
            updatedAt: payload.message.createdAt || new Date().toISOString(),
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

  async function assignConversation(conversationId: string) {
    await fetch(`/api/conversations/${conversationId}/assign`, { method: "POST" });
    await refreshAll();
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedConversation || !message.trim()) return;

    await fetch(`/api/conversations/${selectedConversation.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });

    setMessage("");
    await refreshAll();
  }

  async function closeConversation() {
    if (!selectedConversation || !closeReason.trim()) return;

    await fetch(`/api/conversations/${selectedConversation.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: closeReason }),
    });

    setSelectedId(null);
    await refreshAll();
  }

  async function connectWhatsapp() {
    await fetch("/api/whatsapp/connect", { method: "POST" });
    await refreshAll();
  }

  async function disconnectWhatsapp() {
    await fetch("/api/whatsapp/disconnect", { method: "POST" });
    await refreshAll();
  }

  if (loading) {
    return <div className="centered">Carregando operação...</div>;
  }

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <h2>Operação</h2>
        <div className="kpi-grid">
          <div className="kpi-card">
            <span>Aguardando</span>
            <strong>{metrics?.totalAguardando ?? 0}</strong>
          </div>
          <div className="kpi-card">
            <span>Atendimento</span>
            <strong>{metrics?.totalAtendimento ?? 0}</strong>
          </div>
          <div className="kpi-card">
            <span>Encerrados</span>
            <strong>{metrics?.totalEncerrado ?? 0}</strong>
          </div>
        </div>

        <h3>Volume por demanda</h3>
        <div className="volume-list">
          {(metrics?.volumeByDemand || []).map((item) => (
            <div key={item.queueName} className="volume-item">
              <span className="dot" style={{ background: item.colorHex }} />
              <span>{item.queueName}</span>
              <strong>{item.total}</strong>
            </div>
          ))}
        </div>
        {provider === "unofficial" ? (
          <div className="whatsapp-box">
            <h3>WhatsApp QR</h3>
            <p>Status: <strong>{waState?.status || "idle"}</strong></p>
            {waState?.connectedPhone ? <p>Conectado: {waState.connectedPhone}</p> : null}
            {waState?.lastError ? <p className="error-text">{waState.lastError}</p> : null}
            {waState?.qrDataUrl ? (
              <Image src={waState.qrDataUrl} alt="QR Code WhatsApp" className="qr-image" width={180} height={180} />
            ) : null}
            <div className="wa-actions">
              <button type="button" onClick={connectWhatsapp}>Gerar QR</button>
              <button type="button" onClick={disconnectWhatsapp}>Desconectar</button>
            </div>
          </div>
        ) : null}
      </aside>

      <section className="conversation-list">
        <div className="list-header">
          <h2>Chamados</h2>
          <a href="/dashboard/queues" className="action-link">
            Gerenciar demandas
          </a>
        </div>

        {conversations.map((conversation) => {
          const lastMessage = conversation.messages[conversation.messages.length - 1];
          const isSelected = conversation.id === selectedId;
          const queueColor = conversation.queue?.colorHex || "#64748B";

          return (
            <button
              type="button"
              key={conversation.id}
              className={`conversation-card ${isSelected ? "selected" : ""}`}
              onClick={() => setSelectedId(conversation.id)}
            >
              <div className="top">
                <span className="demand-tag" style={{ background: queueColor }}>
                  {conversation.queue?.name || "Não classificado"}
                </span>
                <span className={`status ${conversation.status}`}>{conversation.status.replace("_", " ")}</span>
              </div>
              <strong>{conversation.contact.name || conversation.contact.phoneNumber}</strong>
              <p>{lastMessage?.content || "Sem mensagens"}</p>
              <small>
                Atualizado {formatDistanceToNow(new Date(conversation.updatedAt), { locale: ptBR, addSuffix: true })}
              </small>
            </button>
          );
        })}
      </section>

      <section className="chat-panel">
        {selectedConversation ? (
          <>
            <header>
              <div>
                <h2>{selectedConversation.contact.name || selectedConversation.contact.phoneNumber}</h2>
                <p>{selectedConversation.contact.phoneNumber}</p>
              </div>
              <div className="header-actions">
                <button type="button" onClick={() => assignConversation(selectedConversation.id)}>
                  Assumir
                </button>
              </div>
            </header>

            <div className="messages">
              {selectedConversation.messages.map((item) => (
                <div key={item.id} className={`message ${item.direction}`}>
                  <span>{item.content}</span>
                </div>
              ))}
            </div>

            <form onSubmit={sendMessage} className="send-form">
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Digite a resposta para o cliente"
              />
              <button type="submit">Enviar</button>
            </form>

            <div className="close-row">
              <input value={closeReason} onChange={(event) => setCloseReason(event.target.value)} />
              <button type="button" className="danger" onClick={closeConversation}>
                Encerrar chamado
              </button>
            </div>
          </>
        ) : (
          <div className="centered">Selecione um chamado para iniciar.</div>
        )}
      </section>
    </div>
  );
}

