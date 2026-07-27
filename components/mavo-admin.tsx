"use client";

// A URL de ofertas vem do Cloudinary configurado pela organização; como o
// host é dinâmico, usamos img para não exigir allowlist de domínios no build.
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useRef, useState } from "react";
import { Icon, MavoBrand } from "@/components/mavo-brand";
import type { MavoMasterSession } from "@/lib/mavo-master-auth";
import type { MavoSystemOverview } from "@/lib/mavo-system-overview";

const weekdayNames = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const defaultBusinessHours = weekdayNames.map((_, weekday) => ({
  weekday,
  startTime: weekday === 0 ? "08:00" : "07:00",
  endTime: weekday === 0 ? "14:00" : "21:00",
  timezone: "America/Sao_Paulo",
  isActive: weekday !== 0,
}));

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}min`;
}

function roleName(role: string) {
  if (role === "admin") return "Administrador";
  if (role === "gestor") return "Gestor";
  return "Atendente";
}

type OrganizationOption = { id: string; name: string };

function settingsDraftFromOverview(overview: MavoSystemOverview) {
  return {
    enabled: overview.supermarket.enabled,
    botName: overview.supermarket.botName,
    storeName: overview.supermarket.storeName,
    address: overview.supermarket.address || "",
    mapsUrl: overview.supermarket.mapsUrl || "",
    weekdayHours: overview.supermarket.hours[0] || "",
    sundayHours: overview.supermarket.hours[1] || "",
    offersUrl: overview.supermarket.offersUrl || "",
    offersText: overview.supermarket.offersText || "",
    phone: overview.supermarket.phone || "",
    aiFallbackEnabled: overview.supermarket.aiFallbackEnabled,
  };
}

export function MavoMasterLogin({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading || !configured) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/mavo/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível entrar.");
      window.location.href = "/mavo";
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Não foi possível entrar.");
      setLoading(false);
    }
  }

  return (
    <main className="master-login-screen">
      <section className="master-login-intro">
        <MavoBrand inverse />
        <div className="master-login-copy">
          <span className="master-eyebrow"><Icon name="shield" size={15} /> Área restrita</span>
          <h1>Controle completo.<br /><em>Decisões mais rápidas.</em></h1>
          <p>Saúde da plataforma, operação, integrações e configuração do supermercado em uma visão executiva.</p>
        </div>
        <div className="master-security-note">
          <Icon name="database" />
          <div><strong>Dados protegidos</strong><span>Credenciais e tokens nunca são exibidos neste painel.</span></div>
        </div>
      </section>

      <section className="master-login-panel">
        <form className="master-login-card" onSubmit={submit}>
          <span className="master-login-icon"><Icon name="shield" size={24} /></span>
          <div className="master-login-heading">
            <span>Mavo Control</span>
            <h2>Acesso master</h2>
            <p>Entre com a credencial administrativa configurada no ambiente.</p>
          </div>

          {!configured ? (
            <div className="master-config-warning" role="alert">
              <Icon name="activity" size={17} />
              Configure `MAVO_MASTER_EMAIL`, `MAVO_MASTER_PASSWORD` e `JWT_SECRET` no Render.
            </div>
          ) : null}

          <label className="master-field">
            <span>E-mail master</span>
            <div><Icon name="user" size={17} /><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@empresa.com" required /></div>
          </label>
          <label className="master-field">
            <span>Senha</span>
            <div>
              <Icon name="shield" size={17} />
              <input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha segura" minLength={8} required />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}><Icon name={showPassword ? "eye-off" : "eye"} size={17} /></button>
            </div>
          </label>

          {error ? <div className="master-login-error" role="alert"><Icon name="close" size={15} />{error}</div> : null}

          <button className="master-login-submit" type="submit" disabled={loading || !configured}>
            {loading ? <span className="button-spinner" /> : <Icon name="shield" size={17} />}
            {loading ? "Validando acesso..." : "Entrar no painel master"}
          </button>
          <a className="master-back-link" href="/login"><Icon name="arrow-left" size={15} /> Ir para o atendimento</a>
        </form>
      </section>
    </main>
  );
}

export function MavoAdminPanel({
  session,
  initialOverview,
}: {
  session: MavoMasterSession;
  initialOverview: MavoSystemOverview;
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [busy, setBusy] = useState<"refresh" | "sync" | "logout" | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [settingsBusy, setSettingsBusy] = useState<"save" | "upload" | null>(null);
  const [confirmSync, setConfirmSync] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const confirmDialogRef = useRef<HTMLElement>(null);
  const syncTriggerRef = useRef<HTMLButtonElement>(null);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([{ id: initialOverview.organization.id, name: initialOverview.organization.name }]);
  const [settingsDraft, setSettingsDraft] = useState(() => settingsDraftFromOverview(initialOverview));
  const [hoursDraft, setHoursDraft] = useState(() => defaultBusinessHours.map((fallback) => initialOverview.businessHours.find((item) => item.weekday === fallback.weekday) || fallback));

  const applyOverview = (next: MavoSystemOverview) => {
    setOverview(next);
    setSettingsDraft(settingsDraftFromOverview(next));
    setHoursDraft(defaultBusinessHours.map((fallback) => next.businessHours.find((item) => item.weekday === fallback.weekday) || fallback));
  };

  useEffect(() => {
    void fetch("/api/mavo/organizations", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { organizations?: OrganizationOption[]; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar as organizações.");
        if (payload?.organizations?.length) setOrganizations(payload.organizations);
      })
      .catch((error) => setFeedback({ type: "error", text: error instanceof Error ? error.message : "Não foi possível carregar as organizações." }));
  }, []);

  useEffect(() => {
    if (!confirmSync) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const trigger = syncTriggerRef.current;
    confirmButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmSync(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(confirmDialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") || [])];
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      (trigger || previousFocus)?.focus();
    };
  }, [confirmSync]);

  async function refresh(showFeedback = false, organizationId = overview.organization.id) {
    setBusy("refresh");
    try {
      const response = await fetch(`/api/mavo/overview?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/mavo";
        return;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível atualizar o painel.");
      applyOverview(payload.overview);
      if (showFeedback) setFeedback({ type: "success", text: "Painel atualizado com dados do ambiente." });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Falha na atualização." });
    } finally {
      setBusy(null);
    }
  }

  async function changeOrganization(organizationId: string) {
    if (!organizationId || organizationId === overview.organization.id) return;
    await refresh(false, organizationId);
  }

  async function syncSupermarket() {
    setConfirmSync(false);
    setBusy("sync");
    try {
      const response = await fetch(`/api/mavo/actions/sync-supermarket?organizationId=${encodeURIComponent(overview.organization.id)}`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível sincronizar as filas.");
      setFeedback({ type: "success", text: `Filas sincronizadas: ${payload.created} criadas, ${payload.updated} atualizadas e ${payload.paused} pausadas.` });
      await refresh();
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Falha na sincronização." });
      setBusy(null);
    }
  }

  async function saveSupermarketSettings(event: FormEvent) {
    event.preventDefault();
    setSettingsBusy("save");
    try {
      const response = await fetch("/api/admin/supermarket-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Mavo-Organization-Id": overview.organization.id },
        body: JSON.stringify({ ...settingsDraft, businessHours: hoursDraft }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar as configurações.");
      setOverview((current) => ({
        ...current,
        businessHours: payload.businessHours || current.businessHours,
        supermarket: { ...current.supermarket, ...payload.settings },
      }));
      setHoursDraft(payload.businessHours || hoursDraft);
      setFeedback({ type: "success", text: "Configurações do bot salvas com sucesso." });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Falha ao salvar configurações." });
    } finally {
      setSettingsBusy(null);
    }
  }

  async function uploadOfferImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSettingsBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/admin/supermarket-settings/offers-image", { method: "POST", headers: { "X-Mavo-Organization-Id": overview.organization.id }, body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível enviar a imagem.");
      setOverview((current) => ({ ...current, supermarket: { ...current.supermarket, ...payload.settings } }));
      setFeedback({ type: "success", text: "Imagem das ofertas publicada." });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Falha ao enviar imagem." });
    } finally {
      setSettingsBusy(null);
    }
  }

  async function removeOfferImage() {
    setSettingsBusy("upload");
    try {
      const response = await fetch("/api/admin/supermarket-settings/offers-image", { method: "DELETE", headers: { "X-Mavo-Organization-Id": overview.organization.id } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível remover a imagem.");
      setOverview((current) => ({ ...current, supermarket: { ...current.supermarket, ...payload.settings } }));
      setFeedback({ type: "success", text: "Imagem das ofertas removida." });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Falha ao remover imagem." });
    } finally {
      setSettingsBusy(null);
    }
  }

  async function logout() {
    setBusy("logout");
    await fetch("/api/mavo/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/mavo";
  }

  const activeConversations =
    overview.operation.conversations.aguardando +
    overview.operation.conversations.em_atendimento +
    overview.operation.conversations.pendente_cliente;

  return (
    <div className="master-shell">
      <aside className="master-sidebar">
        <MavoBrand inverse />
        <div className="master-sidebar-badge"><Icon name="shield" size={14} /> Controle master</div>
        <nav aria-label="Seções do painel master">
          <a href="#overview"><Icon name="activity" />Visão geral</a>
          <a href="#integrations"><Icon name="server" />Infraestrutura</a>
          <a href="#operation"><Icon name="inbox" />Operação</a>
          <a href="#supermarket"><Icon name="store" />Supermercado</a>
          <a href="#access"><Icon name="user" />Acessos</a>
          <a href="#audit"><Icon name="shield" />Auditoria</a>
        </nav>
        <div className="master-sidebar-footer">
          <span>{session.name}</span>
          <small>{session.email}</small>
          <button type="button" onClick={logout} disabled={busy === "logout"}><Icon name="logout" size={15} /> Sair</button>
        </div>
      </aside>

      <main className="master-main">
        <header className="master-topbar">
          <div>
            <span className="master-mobile-brand"><MavoBrand /></span>
            <p>Central de administração</p>
            <h1>{overview.organization.name}</h1>
          </div>
          <div className="master-top-actions">
            <span className={`master-live-chip ${overview.database.status}`}><i />{overview.database.status === "online" ? "Sistema operacional" : "Atenção necessária"}</span>
            <label className="master-organization-picker"><span>Organização</span><select value={overview.organization.id} onChange={(event) => void changeOrganization(event.target.value)} disabled={busy !== null || settingsBusy !== null}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
            <button type="button" onClick={() => refresh(true)} disabled={Boolean(busy)}><Icon name="refresh" size={16} />{busy === "refresh" ? "Atualizando..." : "Atualizar"}</button>
            <a href="/dashboard">Abrir atendimento</a>
          </div>
        </header>

        {feedback ? <div className={`master-feedback ${feedback.type}`} role="status"><Icon name={feedback.type === "success" ? "check" : "close"} size={16} />{feedback.text}<button onClick={() => setFeedback(null)} aria-label="Fechar"><Icon name="close" size={14} /></button></div> : null}

        <section className="master-hero" id="overview">
          <div>
            <span><Icon name="sparkle" size={15} /> Mavo Control Center</span>
            <h2>Toda a operação,<br /><em>sem pontos cegos.</em></h2>
            <p>Indicadores, infraestrutura e configurações críticas consolidados em tempo real.</p>
          </div>
          <div className="master-hero-meta">
            <div><span>Ambiente</span><strong>{overview.deployment.platform} · {overview.deployment.environment}</strong></div>
            <div><span>Última leitura</span><strong>{formatDate(overview.generatedAt)}</strong></div>
            <div><span>Versão</span><strong>v{overview.deployment.appVersion}</strong></div>
          </div>
        </section>

        <section className="master-kpis" aria-label="Indicadores principais">
          <article><span className="master-kpi-icon violet"><Icon name="inbox" /></span><div><small>Conversas ativas</small><strong>{formatNumber(activeConversations)}</strong><em>{overview.operation.conversations.aguardando} aguardando</em></div></article>
          <article><span className="master-kpi-icon green"><Icon name="user" /></span><div><small>Equipe ativa</small><strong>{formatNumber(overview.operation.activeUsers)}</strong><em>{overview.operation.users} cadastrados</em></div></article>
          <article><span className="master-kpi-icon blue"><Icon name="send" /></span><div><small>Mensagens hoje</small><strong>{formatNumber(overview.operation.messagesToday)}</strong><em>{overview.operation.inboundToday} recebidas · {overview.operation.outboundToday} enviadas</em></div></article>
          <article><span className={`master-kpi-icon ${overview.database.status === "online" ? "green" : "red"}`}><Icon name="database" /></span><div><small>Supabase</small><strong>{overview.database.status === "online" ? `${overview.database.latencyMs} ms` : "Offline"}</strong><em>{overview.database.connectionMode}</em></div></article>
        </section>

        <section className="master-section" id="integrations">
          <div className="master-section-heading"><div><span>Infraestrutura</span><h2>Saúde das integrações</h2><p>Nenhum token ou segredo é exposto nesta visão.</p></div><Icon name="server" size={23} /></div>
          <div className="master-integration-grid">
            {overview.integrations.map((integration) => (
              <article key={integration.id}>
                <span className={`master-status-dot ${integration.status}`}><i /></span>
                <div><strong>{integration.name}</strong><p>{integration.detail}</p></div>
                <em>{integration.status === "online" ? "Online" : integration.status === "configured" ? "Configurado" : integration.status === "attention" ? "Atenção" : "Opcional"}</em>
              </article>
            ))}
          </div>
          <div className="master-deploy-strip">
            <div><span>Serviço</span><strong>{overview.deployment.serviceName}</strong></div>
            <div><span>Host público</span><strong>{overview.deployment.publicHost || "Ambiente local"}</strong></div>
            <div><span>Commit</span><strong>{overview.deployment.gitCommit || "—"}</strong></div>
            <div><span>Node.js</span><strong>{overview.deployment.nodeVersion}</strong></div>
            <div><span>Uptime</span><strong>{formatUptime(overview.deployment.uptimeSeconds)}</strong></div>
            <div><span>Banco</span><strong>{overview.database.host || "Não configurado"}</strong></div>
          </div>
        </section>

        <section className="master-two-columns" id="operation">
          <article className="master-card">
            <div className="master-card-title"><div><span>Operação</span><h2>Conversas por status</h2></div><Icon name="activity" /></div>
            <div className="master-status-list">
              <div><i className="waiting" /><span>Aguardando</span><strong>{overview.operation.conversations.aguardando}</strong></div>
              <div><i className="serving" /><span>Em atendimento</span><strong>{overview.operation.conversations.em_atendimento}</strong></div>
              <div><i className="pending" /><span>Aguardando cliente</span><strong>{overview.operation.conversations.pendente_cliente}</strong></div>
              <div><i className="closed" /><span>Encerradas</span><strong>{overview.operation.conversations.encerrado}</strong></div>
            </div>
            <div className="master-mini-kpis"><div><span>1ª resposta média</span><strong>{overview.operation.firstResponseAverageMinutes == null ? "—" : `${overview.operation.firstResponseAverageMinutes} min`}</strong></div><div><span>Satisfação</span><strong>{overview.operation.satisfactionAverage == null ? "—" : `${overview.operation.satisfactionAverage}/5`}</strong></div><div><span>Contatos</span><strong>{formatNumber(overview.operation.contacts)}</strong></div></div>
          </article>

          <article className="master-card queue-overview-card">
            <div className="master-card-title"><div><span>Distribuição</span><h2>Filas do atendimento</h2></div><div className="master-card-actions"><a href="/dashboard/queues">Editar filas</a><button ref={syncTriggerRef} type="button" onClick={() => setConfirmSync(true)} disabled={Boolean(busy)}>{busy === "sync" ? "Sincronizando..." : "Sincronizar menu"}</button></div></div>
            <div className="master-queue-overview">
              {overview.queues.length ? overview.queues.map((queue) => (
                <div key={queue.id} className={!queue.isActive ? "inactive" : ""}>
                  <i style={{ background: queue.colorHex }} />
                  <span><strong>{queue.menuOption}. {queue.name}</strong><small>SLA {queue.defaultSlaMins} min · {queue.isActive ? "ativa" : "pausada"}</small></span>
                  <em>{queue.openConversations}</em>
                </div>
              )) : <p className="master-empty">As filas aparecerão quando o Supabase estiver conectado.</p>}
            </div>
          </article>
        </section>

        <section className="master-section supermarket-admin" id="supermarket">
          <div className="master-section-heading"><div><span>Conteúdo e automação</span><h2>Configure o Mavo para sua loja</h2><p>Edite o que o cliente recebe no WhatsApp sem alterar código ou variáveis do servidor.</p></div><span className={`master-feature-chip ${overview.supermarket.enabled ? "on" : "off"}`}><i />{overview.supermarket.enabled ? "Bot ativo" : "Bot desativado"}</span></div>
          <form className="master-bot-form" onSubmit={saveSupermarketSettings}>
            <div className="master-config-card">
              <div className="master-config-card-heading"><Icon name="store" /><div><strong>Identidade da loja</strong><span>Esses dados aparecem nas respostas automáticas.</span></div></div>
              <div className="master-config-grid">
                <label className="master-config-field"><span>Nome do assistente</span><input value={settingsDraft.botName} onChange={(event) => setSettingsDraft((value) => ({ ...value, botName: event.target.value }))} maxLength={80} /></label>
                <label className="master-config-field"><span>Nome do supermercado</span><input value={settingsDraft.storeName} onChange={(event) => setSettingsDraft((value) => ({ ...value, storeName: event.target.value }))} maxLength={160} /></label>
                <label className="master-config-field wide"><span>Endereço</span><input value={settingsDraft.address} onChange={(event) => setSettingsDraft((value) => ({ ...value, address: event.target.value }))} maxLength={300} placeholder="Rua, número, bairro e cidade" /></label>
                <label className="master-config-field"><span>Link do mapa</span><input type="url" value={settingsDraft.mapsUrl} onChange={(event) => setSettingsDraft((value) => ({ ...value, mapsUrl: event.target.value }))} placeholder="https://maps.google.com/..." /></label>
                <label className="master-config-field"><span>Telefone</span><input value={settingsDraft.phone} onChange={(event) => setSettingsDraft((value) => ({ ...value, phone: event.target.value }))} placeholder="(00) 0000-0000" /></label>
              </div>
            </div>

            <div className="master-config-card offer-config-card">
              <div className="master-config-card-heading"><Icon name="sparkle" /><div><strong>1 · Ofertas e promoções</strong><span>Publique o encarte do dia com texto, link e imagem.</span></div></div>
              <div className="master-offer-layout">
                <div className="master-config-grid">
                  <label className="master-config-field wide"><span>Mensagem das ofertas</span><textarea value={settingsDraft.offersText} onChange={(event) => setSettingsDraft((value) => ({ ...value, offersText: event.target.value }))} rows={5} maxLength={4000} placeholder="Ex.: Café, arroz e produtos de limpeza com descontos especiais hoje." /></label>
                  <label className="master-config-field wide"><span>Link do encarte (opcional)</span><input type="url" value={settingsDraft.offersUrl} onChange={(event) => setSettingsDraft((value) => ({ ...value, offersUrl: event.target.value }))} placeholder="https://..." /></label>
                </div>
                <div className="master-offer-upload">
                  {overview.supermarket.offersImageUrl ? <img src={overview.supermarket.offersImageUrl} alt="Prévia das ofertas" /> : <div className="master-offer-empty"><Icon name="sparkle" size={24} /><span>Nenhum encarte publicado</span></div>}
                  <label className="master-upload-button"><Icon name="plus" size={15} />{settingsBusy === "upload" ? "Enviando..." : "Escolher imagem"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadOfferImage} disabled={Boolean(settingsBusy)} /></label>
                  {overview.supermarket.offersImageUrl ? <button type="button" className="master-remove-button" onClick={removeOfferImage} disabled={Boolean(settingsBusy)}>Remover imagem</button> : null}
                </div>
              </div>
            </div>

            <div className="master-config-card">
              <div className="master-config-card-heading"><Icon name="clock" /><div><strong>2 · Horários e localização</strong><span>Controle os horários reais usados na triagem fora do expediente.</span></div></div>
              <div className="master-hours-editor">
                {hoursDraft.map((item) => <label key={item.weekday}><span>{weekdayNames[item.weekday]}</span><input type="time" value={item.startTime} disabled={!item.isActive} onChange={(event) => setHoursDraft((rows) => rows.map((row) => row.weekday === item.weekday ? { ...row, startTime: event.target.value } : row))} /><b>até</b><input type="time" value={item.endTime} disabled={!item.isActive} onChange={(event) => setHoursDraft((rows) => rows.map((row) => row.weekday === item.weekday ? { ...row, endTime: event.target.value } : row))} /><button type="button" onClick={() => setHoursDraft((rows) => rows.map((row) => row.weekday === item.weekday ? { ...row, isActive: !row.isActive } : row))}>{item.isActive ? "Aberto" : "Fechado"}</button></label>)}
              </div>
            </div>

            <div className="master-config-footer">
              <div className="master-switch-control">
                <span id="mavo-bot-enabled-label">Bot Mavo ativo</span>
                <button type="button" role="switch" aria-checked={settingsDraft.enabled} aria-labelledby="mavo-bot-enabled-label" disabled={settingsBusy !== null} onClick={() => setSettingsDraft((value) => ({ ...value, enabled: !value.enabled }))} className={`master-switch ${settingsDraft.enabled ? "is-on" : ""}`}><i /></button>
              </div>
              <div className="master-switch-control">
                <span id="mavo-ai-fallback-label">Usar IA para mensagens não reconhecidas</span>
                <button type="button" role="switch" aria-checked={settingsDraft.aiFallbackEnabled} aria-labelledby="mavo-ai-fallback-label" disabled={settingsBusy !== null} onClick={() => setSettingsDraft((value) => ({ ...value, aiFallbackEnabled: !value.aiFallbackEnabled }))} className={`master-switch ${settingsDraft.aiFallbackEnabled ? "is-on" : ""}`}><i /></button>
              </div>
              <button type="submit" className="master-save-button" disabled={settingsBusy !== null}>{settingsBusy === "save" ? "Salvando..." : "Salvar configurações"}</button>
            </div>
          </form>
          <div className="supermarket-readiness ready"><span><Icon name="check" size={22} /></span><div><strong>Menu restante configurável</strong><p>Produtos e disponibilidade, setores frescos, trocas e atendimento humano são administrados em Demandas e filas. “Entregas e pedidos” foi removido do menu do cliente.</p></div></div>
        </section>

        <section className="master-two-columns" id="access">
          <article className="master-card master-table-card">
            <div className="master-card-title"><div><span>Acessos</span><h2>Usuários da operação</h2></div><strong>{overview.operation.activeUsers} ativos</strong></div>
            <div className="master-users-table">
              {overview.users.length ? overview.users.map((user) => (
                <div key={user.id}>
                  <span className="master-user-avatar">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                  <span><strong>{user.name}</strong><small>{user.email}</small></span>
                  <em>{roleName(user.role)}</em>
                  <i className={user.isActive ? "active" : "inactive"}>{user.isActive ? "Ativo" : "Pausado"}</i>
                </div>
              )) : <p className="master-empty">Nenhum usuário disponível.</p>}
            </div>
          </article>

          <article className="master-card">
            <div className="master-card-title"><div><span>Disponibilidade</span><h2>Horário operacional</h2></div><Icon name="clock" /></div>
            <div className="master-hours-list">
              {overview.businessHours.length ? overview.businessHours.map((item) => (
                <div key={item.weekday}><span>{weekdayNames[item.weekday] || `Dia ${item.weekday}`}</span><strong>{item.isActive ? `${item.startTime} — ${item.endTime}` : "Fechado"}</strong></div>
              )) : <p className="master-empty">Usando o horário padrão até o cadastro no banco.</p>}
            </div>
          </article>
        </section>

        <section className="master-section" id="audit">
          <div className="master-section-heading"><div><span>Governança</span><h2>Atividade administrativa recente</h2><p>Últimos eventos registrados no log de auditoria.</p></div><Icon name="shield" size={23} /></div>
          <div className="master-audit-list">
            {overview.recentAudit.length ? overview.recentAudit.map((item) => (
              <div key={item.id}><span><Icon name="check" size={14} /></span><div><strong>{item.action.replaceAll("_", " ")}</strong><p>{item.entityType} · {item.entityId}</p></div><time>{formatDate(item.createdAt)}</time></div>
            )) : <p className="master-empty">Os eventos aparecerão após o início da operação.</p>}
          </div>
        </section>

        <footer className="master-footer"><span>Mavo Talk · Painel master protegido</span><span>Dados atualizados em {formatDate(overview.generatedAt)}</span></footer>
      </main>
      {confirmSync ? <div className="master-confirm-backdrop" role="presentation" onMouseDown={() => setConfirmSync(false)}><section ref={confirmDialogRef} className="master-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-confirm-title" aria-describedby="sync-confirm-description" onMouseDown={(event) => event.stopPropagation()}><h2 id="sync-confirm-title">Sincronizar menu do supermercado?</h2><p id="sync-confirm-description">As sete filas padrão serão sincronizadas e filas fora do modelo serão pausadas. Atendimentos e histórico não serão removidos.</p><div><button type="button" onClick={() => setConfirmSync(false)}>Cancelar</button><button ref={confirmButtonRef} type="button" onClick={() => void syncSupermarket()}>Sincronizar filas</button></div></section></div> : null}
    </div>
  );
}
