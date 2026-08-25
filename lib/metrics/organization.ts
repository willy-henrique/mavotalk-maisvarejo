import { queryTenantDatabase } from "@/lib/db";

export type MetricsOrganization = {
  id: string;
  name: string;
};

export async function organizationForMetrics(
  organizationId: string,
  userId: string,
): Promise<MetricsOrganization> {
  const resultado = await queryTenantDatabase<{ id: string; name: string }>(
    organizationId,
    `SELECT o.id, o.name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
      WHERE u.organization_id = $1 AND u.id = $2`,
    [organizationId, userId],
  );
  const organizacao = resultado.rows[0];
  if (!organizacao) {
    throw new Error("Usuário da sessão não pertence à organização");
  }
  return { id: String(organizacao.id), name: String(organizacao.name) };
}
