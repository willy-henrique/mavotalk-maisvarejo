import type { PersonalWorkspaceItemInput } from "@/lib/personal-workspace";
import type { RemoteAccessInput } from "@/lib/remote-accesses";

function text(value: unknown, max: number): string | undefined;
function text(value: unknown, max: number, nullable: true): string | null | undefined;
function text(value: unknown, max: number, nullable = false): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (typeof value !== "string") throw new Error("Campo de texto inválido.");
  const normalized = value.trim();
  if (normalized.length > max) throw new Error("Campo excede o tamanho permitido.");
  return normalized;
}

function tags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 12) throw new Error("Tags inválidas.");
  return [...new Set(value.map((tag) => String(tag).trim()).filter(Boolean).map((tag) => tag.slice(0, 40)))];
}

function dueAt(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) throw new Error("Prazo inválido.");
  return new Date(value).toISOString();
}

export function personalInput(body: unknown, partial = false): Partial<PersonalWorkspaceItemInput> {
  if (!body || typeof body !== "object") throw new Error("Dados inválidos.");
  const data = body as Record<string, unknown>;
  const kind = data.kind;
  const status = data.status;
  const priority = data.priority;
  if (kind !== undefined && kind !== "note" && kind !== "task" && kind !== "link") throw new Error("Tipo inválido.");
  if (status !== undefined && status !== "open" && status !== "done") throw new Error("Status inválido.");
  if (priority !== undefined && priority !== "low" && priority !== "normal" && priority !== "high") throw new Error("Prioridade inválida.");
  if (!partial && (typeof kind !== "string" || !text(data.title, 160))) throw new Error("Título e tipo são obrigatórios.");
  const result: Partial<PersonalWorkspaceItemInput> = {};
  if (kind !== undefined) result.kind = kind;
  const title = text(data.title, 160); if (title !== undefined) result.title = title;
  const content = text(data.content, 12000); if (content !== undefined) result.content = content;
  const url = text(data.url, 1000, true); if (url !== undefined) result.url = url;
  if (url && !/^https?:\/\//i.test(url)) throw new Error("O link deve iniciar com http:// ou https://.");
  if (status !== undefined) result.status = status;
  if (priority !== undefined) result.priority = priority;
  const parsedDueAt = dueAt(data.dueAt); if (parsedDueAt !== undefined) result.dueAt = parsedDueAt;
  if (data.isPinned !== undefined) { if (typeof data.isPinned !== "boolean") throw new Error("Fixação inválida."); result.isPinned = data.isPinned; }
  const parsedTags = tags(data.tags); if (parsedTags !== undefined) result.tags = parsedTags;
  return result;
}

export function remoteAccessInput(body: unknown, partial = false): Partial<RemoteAccessInput> {
  if (!body || typeof body !== "object") throw new Error("Dados inválidos.");
  const data = body as Record<string, unknown>;
  const provider = data.provider;
  if (provider !== undefined && provider !== "anydesk" && provider !== "teamviewer" && provider !== "other") throw new Error("Provedor inválido.");
  if (!partial && (typeof provider !== "string" || !text(data.label, 160) || !text(data.address, 200))) throw new Error("Nome, provedor e ID são obrigatórios.");
  const result: Partial<RemoteAccessInput> = {};
  if (provider !== undefined) result.provider = provider;
  const label = text(data.label, 160); if (label !== undefined) result.label = label;
  const address = text(data.address, 200); if (address !== undefined) result.address = address;
  const username = text(data.username, 160, true); if (username !== undefined) result.username = username;
  const location = text(data.location, 160, true); if (location !== undefined) result.location = location;
  const responsibleName = text(data.responsibleName, 160, true); if (responsibleName !== undefined) result.responsibleName = responsibleName;
  const notes = text(data.notes, 4000); if (notes !== undefined) result.notes = notes;
  const parsedTags = tags(data.tags); if (parsedTags !== undefined) result.tags = parsedTags;
  if (data.isActive !== undefined) { if (typeof data.isActive !== "boolean") throw new Error("Status inválido."); result.isActive = data.isActive; }
  const secret = text(data.secret, 512, true); if (secret !== undefined) result.secret = secret;
  return result;
}
