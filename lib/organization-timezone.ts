import { queryTenantDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";
import { defaultTimeZone, resolveTimeZone } from "@/lib/timezone";

/**
 * Fuso da loja, na ordem em que a operação o cadastra: a unidade da própria fila
 * vence, depois qualquer unidade da organização e, por último, o expediente
 * legado. Uma instalação anterior às migrations de localização simplesmente cai
 * no padrão — resolver o fuso nunca pode impedir uma resposta ao cliente.
 */
export async function getOrganizationTimeZone(organizationId: string, queueId?: string | null): Promise<string> {
  try {
    const result = await queryTenantDatabase<{ timezone: string | null }>(
      organizationId,
      `SELECT timezone FROM (
         SELECT timezone, CASE WHEN queue_id = $2 THEN 0 WHEN queue_id IS NULL THEN 1 ELSE 2 END AS priority
           FROM business_locations WHERE organization_id = $1
         UNION ALL
         SELECT timezone, 3 FROM business_hours WHERE organization_id = $1
       ) sources
       WHERE timezone IS NOT NULL AND trim(timezone) <> ''
       ORDER BY priority
       LIMIT 1`,
      [organizationId, queueId || null],
    );
    return resolveTimeZone(result.rows[0]?.timezone);
  } catch (error) {
    logger.warn({ organizationId, queueId, err: error }, "organization_timezone_fallback");
    return defaultTimeZone();
  }
}
