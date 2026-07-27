import { queryDatabase } from "@/lib/db";

export type MavoOrganization = {
  id: string;
  name: string;
};

export function defaultMavoOrganizationId(): string {
  return String(process.env.DEFAULT_ORG_ID || "org_willtalk_default").trim();
}

function normalizedOrganizationId(value: string | null | undefined): string {
  return String(value || "").trim().slice(0, 160);
}

export async function listMavoOrganizations(): Promise<MavoOrganization[]> {
  const result = await queryDatabase<{ id: string; name: string }>(
    "SELECT id, name FROM organizations ORDER BY name ASC, id ASC LIMIT 200",
  );
  return result.rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}

/**
 * A sessão master é uma autoridade de plataforma separada das sessões de
 * operação. Mesmo assim, a organização escolhida nunca é aceita cegamente:
 * ela precisa existir antes de ser usada em consultas ou mutações.
 */
export async function resolveMavoOrganization(
  requestedOrganizationId?: string | null,
): Promise<MavoOrganization | null> {
  const id = normalizedOrganizationId(requestedOrganizationId) || defaultMavoOrganizationId();
  if (!id) return null;
  const result = await queryDatabase<{ id: string; name: string }>(
    "SELECT id, name FROM organizations WHERE id = $1 LIMIT 1",
    [id],
  );
  const row = result.rows[0];
  return row ? { id: String(row.id), name: String(row.name) } : null;
}
