import { queryTenantDatabase } from "@/lib/db";

export type MenuRole = "admin" | "gestor" | "atendente";
const MENU_ROLES: MenuRole[] = ["admin", "gestor", "atendente"];
export type MenuPermissionAction = "read" | "create" | "update" | "delete" | "admin";
export const MENU_PERMISSION_ACTIONS: MenuPermissionAction[] = ["read", "create", "update", "delete", "admin"];

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
  { id: "contacts", label: "Contatos" },
  { id: "personal_workspace", label: "Meu espaço" },
  { id: "painel", label: "Conexão WhatsApp" },
  { id: "remote_accesses", label: "Acessos remotos" },
  { id: "business_sync", label: "Agentes e sincronização" },
  { id: "business_audit", label: "Auditoria gerencial" },
  { id: "admin_business_access", label: "Acessos gerenciais" },
  { id: "admin_users", label: "Equipe" },
  { id: "admin_types", label: "Filas e automações" },
  { id: "admin_orders", label: "Pedidos" },
  { id: "admin_quick_replies", label: "Respostas Rápidas" },
  { id: "admin_menu_settings", label: "Menu do painel", lockedForAdmin: true },
];
const MENU_ITEM_IDS = new Set(MENU_ITEMS.map((item) => item.id));

const DEFAULT_VISIBILITY: Record<string, Record<MenuRole, boolean>> = {
  inbox: { admin: true, gestor: true, atendente: true },
  dashboard: { admin: true, gestor: true, atendente: false },
  contacts: { admin: true, gestor: true, atendente: true },
  personal_workspace: { admin: true, gestor: true, atendente: true },
  painel: { admin: true, gestor: true, atendente: false },
  remote_accesses: { admin: true, gestor: true, atendente: true },
  business_sync: { admin: true, gestor: false, atendente: false },
  business_audit: { admin: true, gestor: false, atendente: false },
  admin_business_access: { admin: true, gestor: false, atendente: false },
  admin_users: { admin: true, gestor: false, atendente: false },
  admin_types: { admin: true, gestor: false, atendente: false },
  admin_orders: { admin: true, gestor: false, atendente: false },
  admin_quick_replies: { admin: true, gestor: false, atendente: false },
  admin_menu_settings: { admin: true, gestor: false, atendente: false },
};

export type MenuVisibilityMap = Record<string, Record<MenuRole, boolean>>;
export type MenuPermissionMap = Record<string, Record<MenuRole, Record<MenuPermissionAction, boolean>>>;

const CAN_MANAGE = { admin: true, gestor: true, atendente: false };
const ADMIN_ONLY = { admin: true, gestor: false, atendente: false };
const EVERYONE = { admin: true, gestor: true, atendente: true };
const NONE = { admin: false, gestor: false, atendente: false };

/**
 * Permissões efetivas por recurso. A matriz é aplicada no servidor; a tela de
 * menu apenas a configura. Assim, esconder uma opção nunca passa a ser uma
 * forma de autorização. Itens ausentes conservam estes padrões seguros.
 */
const DEFAULT_PERMISSIONS: Record<string, Record<MenuPermissionAction, Record<MenuRole, boolean>>> = {
  inbox: { read: EVERYONE, create: EVERYONE, update: EVERYONE, delete: NONE, admin: NONE },
  dashboard: { read: CAN_MANAGE, create: NONE, update: NONE, delete: NONE, admin: NONE },
  contacts: { read: EVERYONE, create: EVERYONE, update: EVERYONE, delete: NONE, admin: NONE },
  personal_workspace: { read: EVERYONE, create: EVERYONE, update: EVERYONE, delete: EVERYONE, admin: NONE },
  painel: { read: CAN_MANAGE, create: NONE, update: CAN_MANAGE, delete: NONE, admin: NONE },
  remote_accesses: { read: EVERYONE, create: CAN_MANAGE, update: CAN_MANAGE, delete: NONE, admin: CAN_MANAGE },
  business_sync: { read: CAN_MANAGE, create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY, admin: ADMIN_ONLY },
  business_audit: { read: ADMIN_ONLY, create: NONE, update: NONE, delete: NONE, admin: ADMIN_ONLY },
  admin_business_access: { read: ADMIN_ONLY, create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY, admin: ADMIN_ONLY },
  admin_users: { read: ADMIN_ONLY, create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY, admin: ADMIN_ONLY },
  admin_types: { read: EVERYONE, create: CAN_MANAGE, update: CAN_MANAGE, delete: CAN_MANAGE, admin: CAN_MANAGE },
  admin_orders: { read: CAN_MANAGE, create: CAN_MANAGE, update: CAN_MANAGE, delete: NONE, admin: CAN_MANAGE },
  admin_quick_replies: { read: EVERYONE, create: CAN_MANAGE, update: CAN_MANAGE, delete: CAN_MANAGE, admin: CAN_MANAGE },
  // Administradores não podem remover o próprio acesso a esta política.
  admin_menu_settings: { read: ADMIN_ONLY, create: NONE, update: ADMIN_ONLY, delete: NONE, admin: ADMIN_ONLY },
};

function applyLockedItems(map: MenuVisibilityMap): MenuVisibilityMap {
  for (const item of MENU_ITEMS) {
    if (item.lockedForAdmin) map[item.id].admin = true;
  }
  return map;
}

function applyLockedPermissions(map: MenuPermissionMap): MenuPermissionMap {
  const item = map.admin_menu_settings;
  if (!item) return map;
  for (const action of MENU_PERMISSION_ACTIONS) item.admin[action] = true;
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

function resolvePermissions(
  overrides: Record<string, Partial<Record<MenuRole, Partial<Record<MenuPermissionAction, boolean>>>>>,
): MenuPermissionMap {
  const map = {} as MenuPermissionMap;
  for (const item of MENU_ITEMS) {
    const defaults = DEFAULT_PERMISSIONS[item.id];
    const itemOverrides = overrides[item.id] || {};
    map[item.id] = {} as MenuPermissionMap[string];
    for (const role of MENU_ROLES) {
      const roleOverrides = itemOverrides[role] || {};
      map[item.id][role] = {} as Record<MenuPermissionAction, boolean>;
      for (const action of MENU_PERMISSION_ACTIONS) {
        map[item.id][role][action] = typeof roleOverrides[action] === "boolean"
          ? roleOverrides[action]
          : Boolean(defaults?.[action]?.[role]);
      }
    }
  }
  return applyLockedPermissions(map);
}

async function getOverrides(organizationId: string): Promise<Record<string, Partial<Record<MenuRole, boolean>>>> {
  try {
    const result = await queryTenantDatabase<{ menu_visibility_overrides: unknown }>(
      organizationId,
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

type PermissionOverrides = Record<string, Partial<Record<MenuRole, Partial<Record<MenuPermissionAction, boolean>>>>>;

async function getPermissionOverrides(organizationId: string): Promise<PermissionOverrides> {
  try {
    const result = await queryTenantDatabase<{ menu_permission_overrides: unknown }>(
      organizationId,
      "SELECT menu_permission_overrides FROM organizations WHERE id = $1 LIMIT 1",
      [organizationId],
    );
    const raw = result.rows[0]?.menu_permission_overrides;
    return raw && typeof raw === "object" ? (raw as PermissionOverrides) : {};
  } catch {
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

export async function getMenuPermissions(organizationId: string): Promise<MenuPermissionMap> {
  return resolvePermissions(await getPermissionOverrides(organizationId));
}

export async function hasMenuPermission(
  organizationId: string,
  role: MenuRole,
  itemId: string,
  action: MenuPermissionAction,
): Promise<boolean> {
  const permissions = await getMenuPermissions(organizationId);
  return Boolean(permissions[itemId]?.[role]?.[action]);
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

  await queryTenantDatabase(
    organizationId,
    "UPDATE organizations SET menu_visibility_overrides = $2::jsonb, updated_at = now() WHERE id = $1",
    [organizationId, JSON.stringify(next)],
  );

  return resolveVisibility(next);
}

export async function updateMenuPermissionOverrides(
  organizationId: string,
  patch: PermissionOverrides,
): Promise<MenuPermissionMap> {
  const current = await getPermissionOverrides(organizationId);
  const next: PermissionOverrides = { ...current };

  for (const [itemId, byRole] of Object.entries(patch)) {
    if (!MENU_ITEM_IDS.has(itemId) || !byRole || typeof byRole !== "object") continue;
    const item = { ...(next[itemId] || {}) };
    for (const role of MENU_ROLES) {
      const incoming = byRole[role];
      if (!incoming || typeof incoming !== "object") continue;
      const merged = { ...(item[role] || {}) };
      for (const action of MENU_PERMISSION_ACTIONS) {
        if (typeof incoming[action] === "boolean") merged[action] = incoming[action];
      }
      item[role] = merged;
    }
    next[itemId] = item;
  }

  await queryTenantDatabase(
    organizationId,
    "UPDATE organizations SET menu_permission_overrides = $2::jsonb, updated_at = now() WHERE id = $1",
    [organizationId, JSON.stringify(next)],
  );
  return resolvePermissions(next);
}

