import { queryTenantDatabase } from "@/lib/db";

export type OpcoesFiltro = {
  filas: Array<{ id: string; nome: string; cor: string }>;
  atendentes: Array<{ id: string; nome: string }>;
};

type LinhaFila = {
  id: string;
  name: string;
  color_hex: string | null;
};

type LinhaAtendente = {
  id: string;
  name: string;
};

const SQL_FILAS = `
  SELECT id, name, color_hex
  FROM queues
  WHERE organization_id = $1
    AND is_active = true
  ORDER BY name, id
`;

const SQL_ATENDENTES = `
  SELECT id, name
  FROM users
  WHERE organization_id = $1
    AND is_active = true
  ORDER BY name, id
`;

export async function opcoesDeFiltro(organizationId: string): Promise<OpcoesFiltro> {
  const [filas, atendentes] = await Promise.all([
    queryTenantDatabase<LinhaFila>(organizationId, SQL_FILAS, [organizationId]),
    queryTenantDatabase<LinhaAtendente>(organizationId, SQL_ATENDENTES, [organizationId]),
  ]);

  return {
    filas: filas.rows.map((fila) => ({
      id: String(fila.id),
      nome: String(fila.name),
      cor: String(fila.color_hex ?? "#6C5CE7"),
    })),
    atendentes: atendentes.rows.map((atendente) => ({
      id: String(atendente.id),
      nome: String(atendente.name),
    })),
  };
}
