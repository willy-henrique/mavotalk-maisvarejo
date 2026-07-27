import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/api";
import { createAuditLog } from "@/lib/repo";
import { MENU_ITEMS, getMenuVisibility, updateMenuVisibilityOverrides, type MenuRole } from "@/lib/menu-settings";

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

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = requireRole(["admin"], auth.session.role);
  if (denied) return denied;

  const visibility = await getMenuVisibility(auth.session.organizationId);
  return NextResponse.json({ items: MENU_ITEMS, visibility });
}

export async function PATCH(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = requireRole(["admin"], auth.session.role);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const patch = parsePatch(body);
  const visibility = await updateMenuVisibilityOverrides(auth.session.organizationId, patch);
  await createAuditLog(auth.session.organizationId, auth.session.userId, "update_menu_visibility", "organization", auth.session.organizationId, {
    changedItems: Object.keys(patch),
  });

  return NextResponse.json({ items: MENU_ITEMS, visibility });
}
