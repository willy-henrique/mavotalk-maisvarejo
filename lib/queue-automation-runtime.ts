import { getOrganizationTimeZone } from "@/lib/organization-timezone";
import { getActivePromotions, getPublishedQueueConfiguration, getRuntimeOffersConfiguration } from "@/lib/queue-automation";
import type { BusinessHoursAutomationConfig, OffersAutomationConfig } from "@/lib/queue-automation-schemas";
import { describeZonedDeadline, resolveTimeZone, zonedParts } from "@/lib/timezone";

export type BotOutboundMessage = { text: string; mediaUrl?: string | null };

/**
 * Entrega a sequência do bot uma mensagem por vez. O WhatsApp exibe na ordem em que
 * recebe, então disparar os flyers em paralelo embaralha o encarte na conversa do
 * cliente. Uma falha isolada não interrompe o restante da sequência.
 */
export async function deliverInOrder<T extends BotOutboundMessage>(messages: readonly T[], send: (message: T) => Promise<boolean>): Promise<boolean> {
  let delivered = true;
  for (const message of messages) {
    const sent = await send(message).catch(() => false);
    if (!sent) delivered = false;
  }
  return delivered;
}
/** O atalho humano é uma palavra, não um número: a posição 6 pode ser qualquer fila do tenant. */
const footer = (config: { showReturnToMenu: boolean; allowHumanHandoff: boolean }) => {
  const choices = [config.showReturnToMenu ? "digite *0* para voltar ao menu" : null, config.allowHumanHandoff ? "escreva *atendente* para falar com a nossa equipe" : null].filter(Boolean);
  return choices.length ? `\n\nSe precisar, ${choices.join(" ou ")}.` : "";
};
const replace = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] || "");
function zoned(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone);
  return { weekday: parts.weekday, date: parts.dateKey, minutes: parts.minutesOfDay };
}
const minutes = (time: unknown) => { const [h, m] = String(time || "00:00").split(":").map(Number); return h * 60 + m; };
const timeText = (value: unknown) => String(value || "").slice(0, 5);

export async function formatPromotionResponse(organizationId: string, queueId: string, now = new Date()): Promise<BotOutboundMessage[] | null> {
  const configuration = await getRuntimeOffersConfiguration(organizationId, queueId);
  if (!configuration || configuration.queueType !== "offers_promotions" || !configuration.automationConfig.enabled) return null;
  const config = configuration.automationConfig as OffersAutomationConfig;
  const promotions = await getActivePromotions(organizationId, queueId, now);
  if (!promotions.length) return [{ text: `${config.noContentMessage}${footer(config)}` }];
  const timeZone = await getOrganizationTimeZone(organizationId, queueId);
  const ordered = config.deliveryMode === "latest" ? promotions.slice(-1) : promotions;
  const messages: BotOutboundMessage[] = [{ text: config.initialMessage }];
  if (config.beforeFlyerMessage) messages.push({ text: config.beforeFlyerMessage });
  // `maxFlyers` limita imagens enviadas, não promoções: uma campanha pode ter
  // vários flyers e o cliente não deve receber uma sequência sem fim.
  let remainingFlyers = config.maxFlyers;
  for (const promotion of ordered) {
    if (remainingFlyers <= 0) break;
    const images = (promotion.media as Array<{ url?: string }>).map((item) => item?.url).filter((url): url is string => Boolean(url));
    if (!images.length) continue;
    // O prazo sai no fuso da loja: formatar com o relógio do servidor (UTC em
    // produção) empurrava a validade três horas para frente e, perto do fim do
    // dia, para a data seguinte.
    const validity = config.showValidity ? `\nVálida até ${describeZonedDeadline(new Date(promotion.expiresAt), timeZone, now)}.` : "";
    // A legenda acompanha só o primeiro flyer; repeti-la em cada imagem polui a conversa.
    const caption = [promotion.caption || promotion.description || promotion.title, validity].filter(Boolean).join("\n");
    for (const [index, image] of images.slice(0, remainingFlyers).entries()) {
      messages.push({ text: index === 0 ? caption : "", mediaUrl: image });
    }
    remainingFlyers -= Math.min(images.length, remainingFlyers);
  }
  if (config.afterFlyerMessage) messages.push({ text: config.afterFlyerMessage });
  const closing = `${config.closingMessage || ""}${footer(config)}`.trim(); if (closing) messages.push({ text: closing });
  return messages;
}

export type BusinessStatus = { state: "open" | "closed" | "interval" | "special"; openingTime?: string; closingTime?: string; nextOpeningTime?: string; nextOpeningLabel?: string; isSpecial: boolean };
type BusinessContent = { location?: Record<string, unknown> | null; hours?: Record<string, unknown>[]; exceptions?: Record<string, unknown>[] };
type Opening = { time: string; date: string; dayOffset: number };

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

function openingLabel(opening: Opening) {
  if (opening.dayOffset === 0) return `hoje, às ${opening.time}`;
  if (opening.dayOffset === 1) return `amanhã, às ${opening.time}`;
  const [year, month, day] = opening.date.split("-");
  return `em ${day}/${month}/${year}, às ${opening.time}`;
}

function periodsForDate(content: BusinessContent, date: string, weekday: number) {
  const special = (content.exceptions || []).find((item) => String(item.calendar_date).slice(0, 10) === date);
  if (special) {
    if (special.is_closed) return { isSpecial: true, periods: [] as Array<{ start: string; end: string }> };
    const start = timeText(special.start_time), end = timeText(special.end_time);
    return { isSpecial: true, periods: start && end ? [{ start, end }] : [] as Array<{ start: string; end: string }> };
  }
  const day = (content.hours || []).find((item) => Number(item.weekday) === weekday);
  if (!day?.is_active) return { isSpecial: false, periods: [] as Array<{ start: string; end: string }> };
  const first = { start: timeText(day.start_time), end: timeText(day.end_time) };
  const second = { start: timeText(day.second_start_time), end: timeText(day.second_end_time) };
  return {
    isSpecial: false,
    periods: [first, second].filter((period) => Boolean(period.start && period.end)),
  };
}

function findNextOpening(content: BusinessContent, currentDate: string, currentWeekday: number, fromDayOffset: number): Opening | undefined {
  for (let dayOffset = fromDayOffset; dayOffset <= 7; dayOffset += 1) {
    const schedule = periodsForDate(content, addDays(currentDate, dayOffset), (currentWeekday + dayOffset) % 7);
    const opening = schedule.periods[0]?.start;
    if (opening) return { time: opening, date: addDays(currentDate, dayOffset), dayOffset };
  }
  return undefined;
}

export async function getCurrentBusinessStatus(organizationId: string, queueId: string, now = new Date()): Promise<{ status: BusinessStatus; location: Record<string, unknown> } | null> {
  const published = await getPublishedQueueConfiguration(organizationId, queueId);
  const content = (published?.contentSnapshot || {}) as BusinessContent;
  const location = content.location || null;
  if (!location) return null;
  const current = zoned(now, resolveTimeZone(location.timezone));
  const schedule = periodsForDate(content, current.date, current.weekday);
  const periods = schedule.periods;
  const firstUpcoming = periods.find((period) => current.minutes < minutes(period.start));
  const activeIndex = periods.findIndex((period) => current.minutes >= minutes(period.start) && current.minutes < minutes(period.end));

  if (activeIndex >= 0) {
    const active = periods[activeIndex];
    return { location, status: { state: schedule.isSpecial ? "special" : "open", openingTime: active.start, closingTime: active.end, isSpecial: schedule.isSpecial } };
  }
  if (!schedule.isSpecial && periods.length > 1 && current.minutes >= minutes(periods[0].end) && current.minutes < minutes(periods[1].start)) {
    return { location, status: { state: "interval", nextOpeningTime: periods[1].start, nextOpeningLabel: openingLabel({ time: periods[1].start, date: current.date, dayOffset: 0 }), isSpecial: false } };
  }
  if (firstUpcoming) {
    const opening = { time: firstUpcoming.start, date: current.date, dayOffset: 0 };
    return { location, status: { state: "closed", nextOpeningTime: opening.time, nextOpeningLabel: openingLabel(opening), isSpecial: schedule.isSpecial } };
  }
  const nextOpening = findNextOpening(content, current.date, current.weekday, 1);
  return { location, status: { state: "closed", nextOpeningTime: nextOpening?.time, nextOpeningLabel: nextOpening ? openingLabel(nextOpening) : undefined, isSpecial: schedule.isSpecial } };
}

export async function formatBusinessHoursResponse(organizationId: string, queueId: string, now = new Date()): Promise<BotOutboundMessage[] | null> {
  const configuration = await getPublishedQueueConfiguration(organizationId, queueId); if (!configuration || configuration.queueType !== "business_hours_location" || !configuration.automationConfig.enabled) return null;
  const config = configuration.automationConfig as BusinessHoursAutomationConfig; const current = await getCurrentBusinessStatus(organizationId, queueId, now);
  if (!current) return [{ text: `${config.noContentMessage}${footer(config)}` }];
  const { location, status } = current; const values = { closingTime: status.closingTime || "", openingTime: status.openingTime || "", nextOpeningTime: status.nextOpeningTime || "" };
  const template = status.state === "special" ? config.specialHoursMessage : status.state === "interval" ? config.intervalMessage : status.state === "open" ? config.openMessage : config.closedMessage;
  const lines = [replace(template, values)];
  const address = [location.address_line, location.unit_number, location.district || location.neighborhood, location.city && location.state ? `${location.city} - ${location.state}` : location.city].filter(Boolean).join(" — ");
  if (config.showAddress && address) lines.push(`📍 ${address}`);
  if (config.showReferencePoint && (location.reference_point || location.landmark)) lines.push(`📌 ${location.reference_point || location.landmark}`);
  if (config.showMapsUrl && location.maps_url) lines.push(`🗺️ Ver no Google Maps: ${location.maps_url}`);
  if (config.showPhone && location.phone) lines.push(`📞 Telefone: ${location.phone}`);
  if (config.showNextOpening && status.state === "closed" && status.nextOpeningTime) lines.push(`Próxima abertura: ${status.nextOpeningLabel || status.nextOpeningTime}.`);
  return [{ text: `${lines.join("\n\n")}${footer(config)}` }];
}
