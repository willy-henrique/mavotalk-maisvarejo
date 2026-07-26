/**
 * Respostas rápidas - substituição de variáveis e saudação automática.
 * Variáveis: {user}, {cliente}, {primeiro_nome}, {empresa}, {ticket}, {data}, {hora}, {saudacao}
 */

export function extractFirstName(name: string): string {
  if (!name || typeof name !== "string") return "";
  const n = name
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return "";
  const first = n.split(/\s/)[0];
  return first || "";
}

/** 05:00–11:59 → Bom dia; 12:00–17:59 → Boa tarde; 18:00–04:59 → Boa noite */
export function getGreeting(now?: Date): string {
  const d = now || new Date();
  const h = d.getHours();
  const m = d.getMinutes();
  const totalMins = h * 60 + m;
  if (totalMins >= 5 * 60 && totalMins < 12 * 60) return "Bom dia";
  if (totalMins >= 12 * 60 && totalMins < 18 * 60) return "Boa tarde";
  return "Boa noite";
}

export type QuickReplyContext = {
  user: string;
  cliente: string;
  primeiroNome: string;
  empresa: string;
  ticket: string;
  data: string;
  hora: string;
  saudacao: string;
};

export function replaceVariables(content: string, ctx: QuickReplyContext): string {
  return content
    .replace(/\{user\}/g, ctx.user)
    .replace(/\{cliente\}/g, ctx.cliente)
    .replace(/\{primeiro_nome\}/g, ctx.primeiroNome)
    .replace(/\{empresa\}/g, ctx.empresa)
    .replace(/\{ticket\}/g, ctx.ticket)
    .replace(/\{data\}/g, ctx.data)
    .replace(/\{hora\}/g, ctx.hora)
    .replace(/\{saudacao\}/g, ctx.saudacao);
}

export function buildQuickReplyContext(options: {
  userName: string;
  contactName: string;
  ticketNumber?: string;
  companyName?: string;
  now?: Date;
}): QuickReplyContext {
  const now = options.now || new Date();
  const primeiroNome = extractFirstName(options.contactName);
  const data = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return {
    user: options.userName || "Atendente",
    cliente: options.contactName || "Cliente",
    primeiroNome: primeiroNome || options.contactName || "",
    empresa: options.companyName || "",
    ticket: options.ticketNumber || "",
    data,
    hora,
    saudacao: getGreeting(now),
  };
}
