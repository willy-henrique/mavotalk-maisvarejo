/**
 * Conversões de data no fuso da loja. O painel edita períodos de promoção com
 * `datetime-local`, que é sempre lido como hora local do dispositivo; se o
 * atendente estiver com outro fuso (ou com o celular configurado errado), o
 * horário salvo não bate com o que o bot envia ao cliente. Aqui a loja é o
 * relógio de referência, igual ao runtime do bot em `lib/timezone.ts`.
 */

export const FALLBACK_TIMEZONE = 'America/Sao_Paulo';

export function isSupportedTimeZone(value: unknown): boolean {
  const candidate = String(value ?? '').trim();
  if (!candidate) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(value: unknown): string {
  const candidate = String(value ?? '').trim();
  return isSupportedTimeZone(candidate) ? candidate : FALLBACK_TIMEZONE;
}

export type ZonedFields = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const pad = (value: number) => String(value).padStart(2, '0');

export function zonedFields(value: Date | string, timeZone: string): ZonedFields | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || '0');
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') };
}

/**
 * Instante UTC de um horário informado no fuso da loja. Duas passadas porque o
 * deslocamento depende do próprio instante: em fuso com horário de verão, a
 * primeira estimativa pode cair do lado errado da virada.
 */
export function isoFromZonedFields(fields: ZonedFields & { millisecond?: number }, timeZone: string): string {
  const zone = resolveTimeZone(timeZone);
  const target = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second, fields.millisecond ?? 0);
  const offsetAt = (instant: number) => {
    const whole = Math.floor(instant / 1_000) * 1_000;
    const parts = zonedFields(new Date(whole), zone);
    if (!parts) return 0;
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - whole;
  };
  const firstOffset = offsetAt(target);
  const candidate = target - firstOffset;
  const secondOffset = offsetAt(candidate);
  return new Date(secondOffset === firstOffset ? candidate : target - secondOffset).toISOString();
}

/** Valor de `<input type="datetime-local">` com a hora da loja. */
export function toZonedInputDateTime(value: string, timeZone: string): string {
  const fields = zonedFields(value, timeZone);
  if (!fields) return '';
  return `${fields.year}-${pad(fields.month)}-${pad(fields.day)}T${pad(fields.hour)}:${pad(fields.minute)}`;
}

/** `YYYY-MM-DDTHH:MM` digitado no painel de volta para ISO. */
export function fromZonedInputDateTime(value: string, timeZone: string, fallback: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return fallback;
  const [, year, month, day, hour, minute] = match;
  return isoFromZonedFields({ year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: 0 }, timeZone);
}

/** `HH:MM` na hora da loja, para o campo de hora digitável. */
export function toZonedInputTime(value: string, timeZone: string): string {
  const fields = zonedFields(value, timeZone);
  if (!fields) return '';
  return `${pad(fields.hour)}:${pad(fields.minute)}`;
}

/** Troca só o horário, preservando a data já escolhida no fuso da loja. */
export function withZonedTimeOfDay(value: string, timeZone: string, hours: number, minutes: number, seconds = 0, milliseconds = 0): string {
  const fields = zonedFields(value, timeZone);
  if (!fields) return value;
  return isoFromZonedFields({ ...fields, hour: hours, minute: minutes, second: seconds, millisecond: milliseconds }, timeZone);
}

export function withZonedTimeString(value: string, timeZone: string, time: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!match) return value;
  return withZonedTimeOfDay(value, timeZone, Number(match[1]), Number(match[2]));
}

export function isZonedTimeOfDay(value: string, timeZone: string, hours: number, minutes: number): boolean {
  const fields = zonedFields(value, timeZone);
  return Boolean(fields && fields.hour === hours && fields.minute === minutes);
}

/**
 * Último instante do dia da loja. Encerrar às 23:59:00 tirava a promoção do ar
 * um minuto antes da meia-noite; o cliente lia "até 23:59" e já não recebia nada.
 */
export function zonedEndOfDay(value: string, timeZone: string): string {
  return withZonedTimeOfDay(value, timeZone, 23, 59, 59, 999);
}

export function formatZonedDateTime(value: string, timeZone: string): string {
  const fields = zonedFields(value, timeZone);
  if (!fields) return '';
  return `${pad(fields.day)}/${pad(fields.month)}/${fields.year} às ${pad(fields.hour)}:${pad(fields.minute)}`;
}

/** Rótulo curto do fuso, para o painel deixar claro qual relógio está valendo. */
export function timeZoneLabel(timeZone: string): string {
  const zone = resolveTimeZone(timeZone);
  const city = zone.split('/').pop()?.replace(/_/g, ' ') || zone;
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date())
    .find((part) => part.type === 'timeZoneName')?.value;
  return offset ? `${city} (${offset})` : city;
}
