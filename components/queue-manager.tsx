"use client";

import { FormEvent, useEffect, useState } from "react";
import { Icon, MavoBrand } from "@/components/mavo-brand";
import { SUPERMARKET_QUEUE_PRESET } from "@/lib/supermarket-config";
import type { Queue } from "@/types";

const defaultForm = {
  name: "",
  menuOption: 1,
  colorHex: "#6C5CE7",
  defaultSlaMins: 30,
};

export function QueueManager() {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Queue | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function loadQueues() {
    try {
      const response = await fetch("/api/queues", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar as demandas.");
      const payload = await response.json();
      setQueues(payload.queues);
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Falha ao carregar demandas." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadQueues();
  }, []);

  async function createQueue(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/queues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não foi possível criar a demanda.");
      }

      setForm({ ...defaultForm, menuOption: Math.max(1, ...queues.map((queue) => queue.menuOption + 1)) });
      setFeedback({ type: "success", text: `Demanda “${form.name}” criada com sucesso.` });
      await loadQueues();
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Não foi possível criar a demanda." });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleQueue(queue: Queue) {
    if (togglingId) return;
    setTogglingId(queue.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/queues/${queue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !queue.isActive }),
      });
      if (!response.ok) throw new Error("Não foi possível alterar o status da demanda.");
      setFeedback({
        type: "success",
        text: `${queue.name} foi ${queue.isActive ? "pausada" : "ativada"}.`,
      });
      await loadQueues();
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Falha ao atualizar demanda." });
    } finally {
      setTogglingId(null);
    }
  }

  async function saveQueue(event: FormEvent) {
    event.preventDefault();
    if (!editing || savingEdit) return;
    setSavingEdit(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/queues/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editing.name, menuOption: editing.menuOption, colorHex: editing.colorHex, defaultSlaMins: editing.defaultSlaMins }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar a fila.");
      setEditing(null);
      setFeedback({ type: "success", text: "Fila atualizada com sucesso." });
      await loadQueues();
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Falha ao salvar a fila." });
    } finally {
      setSavingEdit(false);
    }
  }

  async function applySupermarketPreset() {
    if (applyingPreset) return;
    const confirmed = window.confirm(
      "Aplicar o menu de supermercado? As opções 1 a 7 serão atualizadas e as outras filas serão pausadas.",
    );
    if (!confirmed) return;

    setApplyingPreset(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/queues/supermarket-preset", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível aplicar o menu de supermercado.");
      }

      setQueues(payload.queues || []);
      setFeedback({
        type: "success",
        text: `Menu do Mavo pronto: ${SUPERMARKET_QUEUE_PRESET.length} opções configuradas.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao configurar o menu do Mavo.",
      });
    } finally {
      setApplyingPreset(false);
    }
  }

  return (
    <div className="settings-app">
      <aside className="app-sidebar settings-sidebar">
        <MavoBrand inverse />
        <nav className="main-nav" aria-label="Navegação principal">
          <span className="nav-label">Operação</span>
          <a href="/dashboard" className="nav-item">
            <Icon name="inbox" />
            <span>Conversas</span>
          </a>
          <a href="/dashboard/queues" className="nav-item active" aria-current="page">
            <Icon name="queue" />
            <span>Demandas e filas</span>
          </a>
        </nav>

        <div className="sidebar-tip">
          <span><Icon name="sparkle" /></span>
          <div>
            <strong>Organize a triagem</strong>
            <p>Use nomes curtos e cores distintas para o time reconhecer cada demanda rapidamente.</p>
          </div>
        </div>
      </aside>

      <main className="settings-workspace">
        <header className="settings-header">
          <div className="mobile-brand"><MavoBrand /></div>
          <div>
            <a href="/dashboard" className="back-link"><Icon name="arrow-left" size={16} /> Voltar para conversas</a>
            <h1>Demandas e filas</h1>
            <p>Configure como as conversas são classificadas e distribuídas na operação.</p>
          </div>
          <div className="settings-header-actions">
            <button
              type="button"
              className="preset-button"
              onClick={applySupermarketPreset}
              disabled={applyingPreset || loading}
            >
              {applyingPreset ? <span className="button-spinner" /> : <Icon name="sparkle" size={16} />}
              {applyingPreset ? "Configurando..." : "Aplicar menu de supermercado"}
            </button>
            <span className="queue-total"><strong>{queues.filter((queue) => queue.isActive).length}</strong> filas ativas</span>
          </div>
        </header>

        {feedback ? (
          <div className={`toast-message inline ${feedback.type}`} role="status">
            <span><Icon name={feedback.type === "success" ? "check" : "close"} size={16} /></span>
            {feedback.text}
            <button type="button" onClick={() => setFeedback(null)} aria-label="Fechar aviso"><Icon name="close" size={15} /></button>
          </div>
        ) : null}

        <div className="settings-grid">
          <section className="settings-card queue-create-card">
            <div className="settings-card-heading">
              <span className="settings-heading-icon"><Icon name="plus" /></span>
              <div><h2>Nova demanda</h2><p>Crie uma opção para o menu de triagem.</p></div>
            </div>

            <form className="queue-form" onSubmit={createQueue}>
              <div className="field-group full">
                <label htmlFor="queue-name">Nome da demanda</label>
                <input
                  id="queue-name"
                  placeholder="Ex.: Suporte técnico"
                  value={form.name}
                  onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
                  maxLength={60}
                  required
                />
                <small>Esse nome aparece na triagem e nos cards de conversa.</small>
              </div>

              <div className="queue-form-row">
                <div className="field-group">
                  <label htmlFor="menu-option">Opção no menu</label>
                  <input
                    id="menu-option"
                    type="number"
                    min={1}
                    max={99}
                    value={form.menuOption}
                    onChange={(event) => setForm((previous) => ({ ...previous, menuOption: Number(event.target.value) }))}
                    required
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="queue-sla">SLA inicial</label>
                  <div className="input-with-suffix">
                    <input
                      id="queue-sla"
                      type="number"
                      min={5}
                      max={1440}
                      value={form.defaultSlaMins}
                      onChange={(event) => setForm((previous) => ({ ...previous, defaultSlaMins: Number(event.target.value) }))}
                      required
                    />
                    <span>min</span>
                  </div>
                </div>
              </div>

              <div className="field-group full">
                <label htmlFor="queue-color">Cor de identificação</label>
                <div className="color-field">
                  <label htmlFor="queue-color" style={{ background: form.colorHex }} aria-label="Escolher cor">
                    <input
                      id="queue-color"
                      type="color"
                      value={form.colorHex}
                      onChange={(event) => setForm((previous) => ({ ...previous, colorHex: event.target.value }))}
                    />
                    <Icon name="sparkle" size={15} />
                  </label>
                  <span>{form.colorHex.toUpperCase()}</span>
                  <div className="queue-preview"><i style={{ background: form.colorHex }} /> {form.name || "Prévia da demanda"}</div>
                </div>
              </div>

              <button className="primary-button queue-submit" type="submit" disabled={submitting}>
                {submitting ? <span className="button-spinner" /> : <Icon name="plus" />}
                {submitting ? "Criando demanda..." : "Criar demanda"}
              </button>
            </form>
          </section>

          <section className="settings-card queue-list-card">
            <div className="settings-card-heading list-heading">
              <span className="settings-heading-icon soft"><Icon name="queue" /></span>
              <div><h2>Demandas cadastradas</h2><p>Gerencie as opções disponíveis para a triagem.</p></div>
              <span>{queues.length} {queues.length === 1 ? "demanda" : "demandas"}</span>
            </div>

            <div className="queue-list">
              {loading ? (
                <div className="queue-list-loading">
                  {[1, 2, 3].map((item) => <span key={item} />)}
                </div>
              ) : queues.length ? queues.map((queue) => (
                <article key={queue.id} className={`queue-item ${queue.isActive ? "" : "inactive"}`}>
                  <span className="queue-menu-number" style={{ "--queue-item-color": queue.colorHex } as React.CSSProperties}>
                    {queue.menuOption}
                  </span>
                  <div className="queue-item-main">
                    <div><strong>{queue.name}</strong><span className={`queue-state ${queue.isActive ? "active" : "paused"}`}><i />{queue.isActive ? "Ativa" : "Pausada"}</span></div>
                    <p><Icon name="clock" size={14} /> Primeira resposta em até <strong>{queue.defaultSlaMins} minutos</strong></p>
                  </div>
                  <div className="queue-item-actions">
                    <button type="button" className="queue-edit-button" onClick={() => setEditing({ ...queue })}>Editar</button>
                    <button type="button" className={`toggle-switch ${queue.isActive ? "on" : ""}`} onClick={() => toggleQueue(queue)} disabled={Boolean(togglingId)} aria-label={`${queue.isActive ? "Pausar" : "Ativar"} demanda ${queue.name}`} aria-pressed={queue.isActive}><span /></button>
                  </div>
                  {editing?.id === queue.id ? <form className="queue-inline-editor" onSubmit={saveQueue}><input aria-label="Nome da fila" value={editing.name} onChange={(event) => setEditing((value) => value ? { ...value, name: event.target.value } : value)} /><input aria-label="Número do menu" type="number" min={1} max={99} value={editing.menuOption} onChange={(event) => setEditing((value) => value ? { ...value, menuOption: Number(event.target.value) } : value)} /><input aria-label="SLA em minutos" type="number" min={5} max={1440} value={editing.defaultSlaMins} onChange={(event) => setEditing((value) => value ? { ...value, defaultSlaMins: Number(event.target.value) } : value)} /><input aria-label="Cor da fila" type="color" value={editing.colorHex} onChange={(event) => setEditing((value) => value ? { ...value, colorHex: event.target.value } : value)} /><button type="submit" className="primary-button" disabled={savingEdit}>{savingEdit ? "Salvando..." : "Salvar"}</button><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button></form> : null}
                </article>
              )) : (
                <div className="queue-empty">
                  <span><Icon name="queue" size={26} /></span>
                  <strong>Nenhuma demanda cadastrada</strong>
                  <p>Preencha o formulário ao lado para criar a primeira fila.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
