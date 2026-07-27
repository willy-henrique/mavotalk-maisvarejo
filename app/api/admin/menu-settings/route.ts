import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { createAuditLog } from "@/lib/repo";
import {
  MENU_ITEMS,
  MENU_PERMISSION_ACTIONS,
  getMenuPermissions,
  getMenuVisibility,
  updateMenuPermissionOverrides,
  updateMenuVisibilityOverrides,
  type MenuPermissionAction,
  type MenuRole,
} from "@/lib/menu-settings";

const MENU_ROLES: MenuRole[] = ["admin", "gestor", "atendente"];

function parsePatch(body: unknown): Record<string, Partial<Record<MenuRole, boolean>>> {
  const result: Record<string, Partial<Record<MenuRole, boolean>>> = {};
  if (!body || typeof body !== "object") return result;
  const entries = (body as Record<string, unknown>).visibility;
  if (!entries || typeof entries !== "object") return result;

  for (const [itemId, roles] of Object.entries(entries as Record<string, unknown>)) {
    if (!roles || typeof roles !== "object") continue;
    const parsedRoles: Partial<Record<MenuRole, boolean>> = {};
    for (const role of MENU_ROLES) {
      const value = (roles as Record<string, unknown>)[role];
      if (typeof value === "boolean") parsedRoles[role] = value;
    }
    if (Object.keys(parsedRoles).length > 0) result[itemId] = parsedRoles;
  }
  return result;
}

function parsePermissions(body: unknown): Record<string, Partial<Record<MenuRole, Partial<Record<MenuPermissionAction, boolean>>>>> {
  const result: Record<string, Partial<Record<MenuRole, Partial<Record<MenuPermissionAction, boolean>>>>> = {};
  if (!body || typeof body !== "object") return result;
  const entries = (body as Record<string, unknown>).permissions;
  if (!entries || typeof entries !== "object") return result;

  for (const [itemId, byRole] of Object.entries(entries as Record<string, unknown>)) {
    if (!byRole || typeof byRole !== "object") continue;
    const parsedRoles: Partial<Record<MenuRole, Partial<Record<MenuPermissionAction, boolean>>>> = {};
    for (const role of MENU_ROLES) {
      const rawActions = (byRole as Record<string, unknown>)[role];
      if (!rawActions || typeof rawActions !== "object") continue;
      const parsedActions: Partial<Record<MenuPermissionAction, boolean>> = {};
      for (const action of MENU_PERMISSION_ACTIONS) {
        const value = (rawActions as Record<string, unknown>)[action];
        if (typeof value === "boolean") parsedActions[action] = value;
      }
      if (Object.keys(parsedActions).length) parsedRoles[role] = parsedActions;
    }
    if (Object.keys(parsedRoles).length) result[itemId] = parsedRoles;
  }
  return result;
}

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_menu_settings", "read");
  if (denied) return denied;

  const [visibility, permissions] = await Promise.all([
    getMenuVisibility(auth.session.organizationId),
    getMenuPermissions(auth.session.organizationId),
  ]);
  return NextResponse.json({ items: MENU_ITEMS, visibility, permissions });
}

export async function PATCH(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_menu_settings", "update");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const patch = parsePatch(body);
  const permissionPatch = parsePermissions(body);
  const [visibility, permissions] = await Promise.all([
    updateMenuVisibilityOverrides(auth.session.organizationId, patch),
    updateMenuPermissionOverrides(auth.session.organizationId, permissionPatch),
  ]);
  await createAuditLog(auth.session.organizationId, auth.session.userId, "update_menu_visibility", "organization", auth.session.organizationId, {
    changedItems: Object.keys(patch),
    changedPermissionItems: Object.keys(permissionPatch),
  });

  return NextResponse.json({ items: MENU_ITEMS, visibility, permissions });
}
