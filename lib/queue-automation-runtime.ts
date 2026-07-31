import { getActivePromotions, getPublishedQueueConfiguration } from "@/lib/queue-automation";
import type { BusinessHoursAutomationConfig, OffersAutomationConfig } from "@/lib/queue-automation-schemas";

export type BotOutboundMessage = { text: string; mediaUrl?: string | null };
const footer = (config: { showReturnToMenu: boolean; allowHumanHandoff: boolean }) => {
  const choices = [config.showReturnToMenu ? "Digite *0* para voltar ao menu" : null, config.allowHumanHandoff ? "Digite *6* para falar com a nossa equipe" : null].filter(Boolean);
  return choices.length ? `\n\n${choices.join(" ou ")}.` : "";
};
const replace = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] || "");
function zoned(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdayMap[get("weekday")] ?? 0, date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
const minutes = (time: unknown) => { const [h, m] = String(time || "00:00").split(":").map(Number); return h * 60 + m; };
const timeText = (value: unknown) => String(value || "").slice(0, 5);

export async function formatPromotionResponse(organizationId: string, queueId: string, now = new Date()): Promise<BotOutboundMessage[] | null> {
  const configuration = await getPublishedQueueConfiguration(organizationId, queueId);
  if (!configuration || configuration.queueType !== "offers_promotions" || !configuration.automationConfig.enabled) return null;
  const config = configuration.automationConfig as OffersAutomationConfig;
  const promotions = await getActivePromotions(organizationId, queueId, now);
  if (!promotions.length) return [{ text: `${config.noContentMessage}${footer(config)}` }];
  const ordered = config.deliveryMode === "latest" ? promotions.slice(-1) : promotions.slice(0, config.maxFlyers);
  const messages: BotOutboundMessage[] = [{ text: config.initialMessage }];
  if (config.beforeFlyerMessage) messages.push({ text: config.beforeFlyerMessage });
  for (const promotion of ordered) {
    const image = (promotion.media as Array<{ url?: string }>)[0]?.url;
    if (!image) continue;
    const validity = config.showValidity ? `\nVálida até ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(promotion.expiresAt))}.` : "";
    messages.push({ text: [promotion.caption || promotion.description || promotion.title, validity].filter(Boolean).join("\n"), mediaUrl: image });
  }
  if (config.afterFlyerMessage) messages.push({ text: config.afterFlyerMessage });
  const closing = `${config.closingMessage || ""}${footer(config)}`.trim(); if (closing) messages.push({ text: closing });
  return messages;
}

export type BusinessStatus = { state: "open" | "closed" | "interval" | "special"; openingTime?: string; closingTime?: string; nextOpeningTime?: string; isSpecial: boolean };
export async function getCurrentBusinessStatus(organizationId: string, queueId: string, now = new Date()): Promise<{ status: BusinessStatus; location: Record<string, unknown> } | null> {
  const published = await getPublishedQueueConfiguration(organizationId, queueId);
  const content = (published?.contentSnapshot || {}) as { location?: Record<string, unknown> | null; hours?: Record<string, unknown>[]; exceptions?: Record<string, unknown>[] };
  const location = content.location || null;
  if (!location) return null;
  const current = zoned(now, String(location.timezone || "America/Sao_Paulo"));
  const special = (content.exceptions || []).find((item) => String(item.calendar_date).slice(0, 10) === current.date);
  if (special) {
    if (special.is_closed) return { location, status: { state: "closed", isSpecial: true } };
    const start = timeText(special.start_time), end = timeText(special.end_time); const within = current.minutes >= minutes(start) && current.minutes < minutes(end);
    return { location, status: { state: within ? "special" : "closed", openingTime: start, closingTime: end, nextOpeningTime: within ? undefined : start, isSpecial: true } };
  }
  const day = (content.hours || []).find((item) => Number(item.weekday) === current.weekday);
  if (day?.is_active) {
    const start = timeText(day.start_time), end = timeText(day.end_time), secondStart = timeText(day.second_start_time), secondEnd = timeText(day.second_end_time);
    if (current.minutes >= minutes(start) && current.minutes < minutes(end)) return { location, status: { state: "open", openingTime: start, closingTime: end, isSpecial: false } };
    if (secondStart && secondEnd && current.minutes >= minutes(secondStart) && current.minutes < minutes(secondEnd)) return { location, status: { state: "open", openingTime: secondStart, closingTime: secondEnd, isSpecial: false } };
    if (secondStart && current.minutes >= minutes(end) && current.minutes < minutes(secondStart)) return { location, status: { state: "interval", nextOpeningTime: secondStart, isSpecial: false } };
    const next = current.minutes < minutes(start) ? start : secondStart && current.minutes < minutes(secondStart) ? secondStart : undefined;
    return { location, status: { state: "closed", nextOpeningTime: next, isSpecial: false } };
  }
  return { location, status: { state: "closed", isSpecial: false } };
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
  if (config.showNextOpening && status.state === "closed" && status.nextOpeningTime) lines.push(`Próxima abertura: ${status.nextOpeningTime}.`);
  return [{ text: `${lines.join("\n\n")}${footer(config)}` }];
}
