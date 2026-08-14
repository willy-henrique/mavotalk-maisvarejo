/**
 * Respostas rápidas - substituição de variáveis e saudação automática.
 * Variáveis: {user}, {cliente}, {primeiro_nome}, {empresa}, {ticket}, {data}, {hora}, {saudacao}
 */

import { formatZonedDate, formatZonedTime, resolveTimeZone, zonedParts } from "@/lib/timezone";

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

/**
 * 05:00–11:59 → Bom dia; 12:00–17:59 → Boa tarde; 18:00–04:59 → Boa noite.
 * Sempre no fuso da loja: com o relógio do servidor (UTC em produção) a mensagem
 * das 21h saía como "Bom dia" e a prévia do painel não batia com o que o cliente
 * recebia.
 */
export function getGreeting(now?: Date, timeZone?: string): string {
  const totalMins = zonedParts(now || new Date(), resolveTimeZone(timeZone)).minutesOfDay;
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
  timeZone?: string;
}): QuickReplyContext {
  const now = options.now || new Date();
  const timeZone = resolveTimeZone(options.timeZone);
  const primeiroNome = extractFirstName(options.contactName);
  const data = formatZonedDate(now, timeZone);
  const hora = formatZonedTime(now, timeZone);
  return {
    user: options.userName || "Atendente",
    cliente: options.contactName || "Cliente",
    primeiroNome: primeiroNome || options.contactName || "",
    empresa: options.companyName || "",
    ticket: options.ticketNumber || "",
    data,
    hora,
    saudacao: getGreeting(now, timeZone),
  };
}
