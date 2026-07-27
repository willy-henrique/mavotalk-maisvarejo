import { queryDatabase } from "@/lib/db";

export type MenuRole = "admin" | "gestor" | "atendente";
const MENU_ROLES: MenuRole[] = ["admin", "gestor", "atendente"];

export type MenuItemDefinition = {
  id: string;
  label: string;
  /** Item que nunca pode ficar oculto para admin, para não trancar o acesso ao próprio painel de configuração. */
  lockedForAdmin?: boolean;
};

/** Fonte única de verdade sobre os itens do menu e quem os vê por padrão. Mantém em sincronia com frontend/components/Sidebar.tsx. */
export const MENU_ITEMS: MenuItemDefinition[] = [
  { id: "inbox", label: "Inbox" },
  { id: "dashboard", label: "Visão da operação" },
  { id: "business", label: "Indicadores do negócio" },
  { id: "contacts", label: "Contatos" },
  { id: "painel", label: "Conexão WhatsApp" },
  { id: "business_sync", label: "Sincronização" },
  { id: "business_audit", label: "Auditoria gerencial" },
  { id: "admin_business_access", label: "Acessos gerenciais" },
  { id: "admin_agents", label: "Agentes cloud" },
  { id: "admin_users", label: "Equipe" },
  { id: "admin_types", label: "Filas e automações" },
  { id: "admin_quick_replies", label: "Respostas Rápidas" },
  { id: "admin_menu_settings", label: "Menu do painel", lockedForAdmin: true },
];
const MENU_ITEM_IDS = new Set(MENU_ITEMS.map((item) => item.id));

const DEFAULT_VISIBILITY: Record<string, Record<MenuRole, boolean>> = {
  inbox: { admin: true, gestor: true, atendente: true },
  dashboard: { admin: true, gestor: true, atendente: false },
  business: { admin: true, gestor: true, atendente: false },
  contacts: { admin: true, gestor: true, atendente: true },
  painel: { admin: true, gestor: true, atendente: false },
  business_sync: { admin: true, gestor: false, atendente: false },
  business_audit: { admin: true, gestor: false, atendente: false },
  admin_business_access: { admin: true, gestor: false, atendente: false },
  admin_agents: { admin: true, gestor: false, atendente: false },
  admin_users: { admin: true, gestor: false, atendente: false },
  admin_types: { admin: true, gestor: false, atendente: false },
  admin_quick_replies: { admin: true, gestor: false, atendente: false },
  admin_menu_settings: { admin: true, gestor: false, atendente: false },
};

export type MenuVisibilityMap = Record<string, Record<MenuRole, boolean>>;

function applyLockedItems(map: MenuVisibilityMap): MenuVisibilityMap {
  for (const item of MENU_ITEMS) {
    if (item.lockedForAdmin) map[item.id].admin = true;
  }
  return map;
}

function resolveVisibility(overrides: Record<string, Partial<Record<MenuRole, boolean>>>): MenuVisibilityMap {
  const map: MenuVisibilityMap = {};
  for (const item of MENU_ITEMS) {
    const defaults = DEFAULT_VISIBILITY[item.id] || { admin: true, gestor: false, atendente: false };
    const override = overrides[item.id] || {};
    map[item.id] = {
      admin: typeof override.admin === "boolean" ? override.admin : defaults.admin,
      gestor: typeof override.gestor === "boolean" ? override.gestor : defaults.gestor,
      atendente: typeof override.atendente === "boolean" ? override.atendente : defaults.atendente,
    };
  }
  return applyLockedItems(map);
}

async function getOverrides(organizationId: string): Promise<Record<string, Partial<Record<MenuRole, boolean>>>> {
  try {
    const result = await queryDatabase<{ menu_visibility_overrides: unknown }>(
      "SELECT menu_visibility_overrides FROM organizations WHERE id = $1 LIMIT 1",
      [organizationId],
    );
    const raw = result.rows[0]?.menu_visibility_overrides;
    return raw && typeof raw === "object" ? (raw as Record<string, Partial<Record<MenuRole, boolean>>>) : {};
  } catch {
    // Instalação antiga sem a coluna ainda migrada: comporta-se como se não houvesse overrides.
    return {};
  }
}

export async function getMenuVisibility(organizationId: string): Promise<MenuVisibilityMap> {
  const overrides = await getOverrides(organizationId);
  return resolveVisibility(overrides);
}

export async function getMenuVisibilityForRole(organizationId: string, role: MenuRole): Promise<Record<string, boolean>> {
  const map = await getMenuVisibility(organizationId);
  const result: Record<string, boolean> = {};
  for (const [itemId, byRole] of Object.entries(map)) result[itemId] = byRole[role];
  return result;
}

/** Aceita apenas ids de itens conhecidos e overrides parciais; ignora o resto silenciosamente. */
export async function updateMenuVisibilityOverrides(
  organizationId: string,
  patch: Record<string, Partial<Record<MenuRole, boolean>>>,
): Promise<MenuVisibilityMap> {
  const current = await getOverrides(organizationId);
  const next: Record<string, Partial<Record<MenuRole, boolean>>> = { ...current };

  for (const [itemId, roles] of Object.entries(patch)) {
    if (!MENU_ITEM_IDS.has(itemId) || !roles || typeof roles !== "object") continue;
    const merged: Partial<Record<MenuRole, boolean>> = { ...(next[itemId] || {}) };
    for (const role of MENU_ROLES) {
      if (typeof roles[role] === "boolean") merged[role] = roles[role];
    }
    next[itemId] = merged;
  }

  await queryDatabase(
    "UPDATE organizations SET menu_visibility_overrides = $2::jsonb, updated_at = now() WHERE id = $1",
    [organizationId, JSON.stringify(next)],
  );

  return resolveVisibility(next);
}
