import { getWhatsappState } from "@/lib/whatsapp-client";
import { getSupermarketBotConfig } from "@/lib/supermarket-bot";
import { getDatabasePool } from "@/lib/db";

export type MavoSystemOverview = {
  generatedAt: string;
  organization: { id: string; name: string };
  database: {
    status: "online" | "offline";
    provider: string;
    host: string | null;
    connectionMode: string;
    latencyMs: number | null;
    errorCode: string | null;
  };
  deployment: {
    platform: "Render" | "Local";
    environment: string;
    serviceName: string;
    publicHost: string | null;
    gitCommit: string | null;
    nodeVersion: string;
    appVersion: string;
    uptimeSeconds: number;
  };
  operation: {
    conversations: Record<"aguardando" | "em_atendimento" | "pendente_cliente" | "encerrado", number>;
    users: number;
    activeUsers: number;
    contacts: number;
    tickets: number;
    messagesToday: number;
    inboundToday: number;
    outboundToday: number;
    firstResponseAverageMinutes: number | null;
    satisfactionAverage: number | null;
  };
  queues: Array<{
    id: string;
    name: string;
    menuOption: number;
    colorHex: string;
    defaultSlaMins: number;
    isActive: boolean;
    openConversations: number;
  }>;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    createdAt: string | null;
  }>;
  businessHours: Array<{
    weekday: number;
    startTime: string;
    endTime: string;
    timezone: string;
    isActive: boolean;
  }>;
  recentAudit: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  }>;
  integrations: Array<{
    id: string;
    name: string;
    status: "online" | "configured" | "attention" | "disabled";
    detail: string;
  }>;
  supermarket: {
    enabled: boolean;
    botName: string;
    storeName: string;
    autoApplyPreset: boolean;
    aiFallbackEnabled: boolean;
    address: string | null;
    hours: string[];
    offersUrl: string | null;
    orderUrl: string | null;
    deliveryInfo: string | null;
    phone: string | null;
    missingFields: string[];
  };
};

function databaseUrl() {
  return String(
    process.env.DATABASE_URL_RUNTIME || process.env.DATABASE_URL || "",
  ).trim();
}

function databaseHost(): string | null {
  try {
    return new URL(databaseUrl()).hostname || null;
  } catch {
    return null;
  }
}

function connectionMode(): string {
  try {
    const port = new URL(databaseUrl()).port;
    if (port === "6543") return "Supavisor — transaction pooler";
    if (databaseHost()?.includes("pooler.supabase.com")) return "Supavisor — session pooler";
    return "Conexão PostgreSQL direta";
  } catch {
    return "Não configurada";
  }
}

function getPool() {
  return getDatabasePool();
}

function numberValue(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function isoValue(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function configured(value: string | undefined): boolean {
  return Boolean(String(value || "").trim());
}

function emptyOperation(): MavoSystemOverview["operation"] {
  return {
    conversations: {
      aguardando: 0,
      em_atendimento: 0,
      pendente_cliente: 0,
      encerrado: 0,
    },
    users: 0,
    activeUsers: 0,
    contacts: 0,
    tickets: 0,
    messagesToday: 0,
    inboundToday: 0,
    outboundToday: 0,
    firstResponseAverageMinutes: null,
    satisfactionAverage: null,
  };
}

export async function checkMavoDatabaseHealth() {
  const startedAt = Date.now();
  try {
    await getPool().query("SELECT 1 AS ok");
    return { online: true, latencyMs: Date.now() - startedAt, errorCode: null };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "DATABASE_UNAVAILABLE";
    return { online: false, latencyMs: null, errorCode: code };
  }
}

export async function getMavoSystemOverview(): Promise<MavoSystemOverview> {
  const organizationId = String(process.env.DEFAULT_ORG_ID || "org_willtalk_default");
  const supermarketConfig = getSupermarketBotConfig();
  const whatsapp = getWhatsappState();
  const healthStartedAt = Date.now();

  let database: MavoSystemOverview["database"] = {
    status: "offline",
    provider: "Supabase PostgreSQL",
    host: databaseHost(),
    connectionMode: connectionMode(),
    latencyMs: null,
    errorCode: null,
  };
  let organization = { id: organizationId, name: supermarketConfig.storeName };
  const operation = emptyOperation();
  let queues: MavoSystemOverview["queues"] = [];
  let users: MavoSystemOverview["users"] = [];
  let businessHours: MavoSystemOverview["businessHours"] = [];
  let recentAudit: MavoSystemOverview["recentAudit"] = [];

  try {
    const pool = getPool();
    const [orgResult, countsResult, conversationsResult, ticketStatsResult, queuesResult, usersResult, hoursResult, auditResult] =
      await Promise.all([
        pool.query("SELECT id, name FROM organizations WHERE id = $1 LIMIT 1", [organizationId]),
        pool.query(
          `SELECT
            (SELECT COUNT(*) FROM users WHERE organization_id = $1) AS users,
            (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND is_active = true) AS active_users,
            (SELECT COUNT(*) FROM contacts WHERE organization_id = $1) AS contacts,
            (SELECT COUNT(*) FROM tickets WHERE organization_id = $1) AS tickets,
            (SELECT COUNT(*) FROM messages WHERE organization_id = $1 AND created_at >= CURRENT_DATE) AS messages_today,
            (SELECT COUNT(*) FROM messages WHERE organization_id = $1 AND direction = 'inbound' AND created_at >= CURRENT_DATE) AS inbound_today,
            (SELECT COUNT(*) FROM messages WHERE organization_id = $1 AND direction = 'outbound' AND created_at >= CURRENT_DATE) AS outbound_today`,
          [organizationId],
        ),
        pool.query(
          "SELECT status, COUNT(*) AS total FROM conversations WHERE organization_id = $1 GROUP BY status",
          [organizationId],
        ),
        pool.query(
          `SELECT
            AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60.0) FILTER (WHERE first_response_at IS NOT NULL) AS first_response_average,
            AVG(satisfaction_score) FILTER (WHERE satisfaction_score BETWEEN 1 AND 5) AS satisfaction_average
           FROM tickets WHERE organization_id = $1`,
          [organizationId],
        ),
        pool.query(
          `SELECT q.id, q.name, q.menu_option, q.color_hex, q.default_sla_mins, q.is_active,
            COUNT(c.id) FILTER (WHERE c.status <> 'encerrado') AS open_conversations
           FROM queues q
           LEFT JOIN conversations c ON c.queue_id = q.id AND c.organization_id = q.organization_id
           WHERE q.organization_id = $1
           GROUP BY q.id
           ORDER BY q.menu_option ASC`,
          [organizationId],
        ),
        pool.query(
          `SELECT id, name, email, role, is_active, created_at
           FROM users WHERE organization_id = $1
           ORDER BY is_active DESC, created_at DESC LIMIT 20`,
          [organizationId],
        ),
        pool.query(
          `SELECT weekday, start_time, end_time, timezone, is_active
           FROM business_hours WHERE organization_id = $1 ORDER BY weekday ASC`,
          [organizationId],
        ),
        pool.query(
          `SELECT id, action, entity_type, entity_id, created_at
           FROM audit_logs WHERE organization_id = $1
           ORDER BY created_at DESC LIMIT 10`,
          [organizationId],
        ),
      ]);

    const countRow = countsResult.rows[0] || {};
    operation.users = numberValue(countRow.users);
    operation.activeUsers = numberValue(countRow.active_users);
    operation.contacts = numberValue(countRow.contacts);
    operation.tickets = numberValue(countRow.tickets);
    operation.messagesToday = numberValue(countRow.messages_today);
    operation.inboundToday = numberValue(countRow.inbound_today);
    operation.outboundToday = numberValue(countRow.outbound_today);
    for (const row of conversationsResult.rows) {
      const status = String(row.status) as keyof typeof operation.conversations;
      if (status in operation.conversations) operation.conversations[status] = numberValue(row.total);
    }
    const ticketStats = ticketStatsResult.rows[0] || {};
    operation.firstResponseAverageMinutes = ticketStats.first_response_average == null
      ? null
      : Math.round(numberValue(ticketStats.first_response_average));
    operation.satisfactionAverage = ticketStats.satisfaction_average == null
      ? null
      : Number(numberValue(ticketStats.satisfaction_average).toFixed(2));

    if (orgResult.rows[0]) {
      organization = { id: String(orgResult.rows[0].id), name: String(orgResult.rows[0].name) };
    }
    queues = queuesResult.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      menuOption: numberValue(row.menu_option),
      colorHex: String(row.color_hex || "#64748B"),
      defaultSlaMins: numberValue(row.default_sla_mins),
      isActive: row.is_active !== false,
      openConversations: numberValue(row.open_conversations),
    }));
    users = usersResult.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      role: String(row.role),
      isActive: row.is_active !== false,
      createdAt: isoValue(row.created_at),
    }));
    businessHours = hoursResult.rows.map((row) => ({
      weekday: numberValue(row.weekday),
      startTime: String(row.start_time),
      endTime: String(row.end_time),
      timezone: String(row.timezone || "America/Sao_Paulo"),
      isActive: row.is_active !== false,
    }));
    recentAudit = auditResult.rows.map((row) => ({
      id: String(row.id),
      action: String(row.action),
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      createdAt: isoValue(row.created_at) || new Date().toISOString(),
    }));
    database = {
      ...database,
      status: "online",
      latencyMs: Date.now() - healthStartedAt,
      errorCode: null,
    };
  } catch (error) {
    database.errorCode = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "DATABASE_UNAVAILABLE";
  }

  const missingFields = [
    !supermarketConfig.address ? "Endereço" : null,
    !supermarketConfig.weekdayHours ? "Horário semanal" : null,
    !supermarketConfig.offersUrl ? "Link de ofertas" : null,
    !supermarketConfig.orderUrl ? "Link de pedidos" : null,
    !supermarketConfig.deliveryInfo ? "Informações de entrega" : null,
    !supermarketConfig.phone ? "Telefone" : null,
  ].filter((item): item is string => Boolean(item));

  const integrations: MavoSystemOverview["integrations"] = [
    {
      id: "database",
      name: "Supabase",
      status: database.status === "online" ? "online" : "attention",
      detail: database.status === "online"
        ? `${database.connectionMode} · ${database.latencyMs} ms`
        : `Banco indisponível${database.errorCode ? ` · ${database.errorCode}` : ""}`,
    },
    {
      id: "whatsapp",
      name: "WhatsApp",
      status: whatsapp.status === "ready" ? "online" : whatsapp.status === "error" ? "attention" : "configured",
      detail: `${process.env.WHATSAPP_PROVIDER || "twilio"} · ${whatsapp.connectedPhone || whatsapp.status}`,
    },
    {
      id: "cerebro",
      name: "Cérebro / IA",
      status: configured(process.env.CEREBRO_ORCHESTRATOR_URL) ? "configured" : "disabled",
      detail: configured(process.env.CEREBRO_ORCHESTRATOR_URL) ? "Orquestrador configurado" : "Não configurado",
    },
    {
      id: "n8n",
      name: "n8n / Webhooks",
      status: configured(process.env.WILLTALK_WEBHOOK_URL) ? "configured" : "disabled",
      detail: configured(process.env.WILLTALK_WEBHOOK_URL) ? "Webhook de saída configurado" : "Webhook opcional desativado",
    },
    {
      id: "cloudinary",
      name: "Cloudinary",
      status: configured(process.env.CLOUDINARY_CLOUD_NAME) ? "configured" : "disabled",
      detail: configured(process.env.CLOUDINARY_CLOUD_NAME) ? "Mídias configuradas" : "Uploads externos desativados",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    organization,
    database,
    deployment: {
      platform: process.env.RENDER === "true" ? "Render" : "Local",
      environment: process.env.NODE_ENV || "development",
      serviceName: String(process.env.RENDER_SERVICE_NAME || "mavo-talk"),
      publicHost: process.env.RENDER_EXTERNAL_HOSTNAME || null,
      gitCommit: process.env.RENDER_GIT_COMMIT?.slice(0, 8) || null,
      nodeVersion: process.version,
      appVersion: process.env.npm_package_version || "0.1.0",
      uptimeSeconds: Math.round(process.uptime()),
    },
    operation,
    queues,
    users,
    businessHours,
    recentAudit,
    integrations,
    supermarket: {
      enabled: supermarketConfig.enabled,
      botName: supermarketConfig.botName,
      storeName: supermarketConfig.storeName,
      autoApplyPreset: String(process.env.SUPERMARKET_AUTO_APPLY_PRESET || "true").toLowerCase() !== "false",
      aiFallbackEnabled: supermarketConfig.aiFallbackEnabled,
      address: supermarketConfig.address,
      hours: [supermarketConfig.weekdayHours, supermarketConfig.sundayHours].filter(
        (item): item is string => Boolean(item),
      ),
      offersUrl: supermarketConfig.offersUrl,
      orderUrl: supermarketConfig.orderUrl,
      deliveryInfo: supermarketConfig.deliveryInfo,
      phone: supermarketConfig.phone,
      missingFields,
    },
  };
}
