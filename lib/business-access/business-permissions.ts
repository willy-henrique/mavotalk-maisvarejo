import type {
  BusinessAccessUser,
  BusinessPermission,
  BusinessRole,
} from "@/lib/business-access/types";

const matrix: Record<BusinessRole, readonly BusinessPermission[]> = {
  owner: [
    "sales.read",
    "finance.read",
    "inventory.read",
    "audit.read",
    "access.manage",
  ],
  director: ["sales.read", "finance.read", "inventory.read", "audit.read"],
  manager: ["sales.read", "inventory.read"],
  analyst: ["sales.read"],
};

export function permissionsForRole(
  role: BusinessRole,
  overrides: BusinessAccessUser["permissions"] = {},
): ReadonlySet<BusinessPermission> {
  const permissions = new Set<BusinessPermission>(matrix[role]);
  for (const [permission, allowed] of Object.entries(overrides)) {
    if (allowed === true) permissions.add(permission as BusinessPermission);
    if (allowed === false) permissions.delete(permission as BusinessPermission);
  }
  return permissions;
}

export function hasBusinessPermission(
  permissions: ReadonlySet<BusinessPermission>,
  required: BusinessPermission,
): boolean {
  return permissions.has(required);
}

export function assertBusinessPermission(
  permissions: ReadonlySet<BusinessPermission>,
  required: BusinessPermission,
): void {
  if (!hasBusinessPermission(permissions, required)) {
    const error = new Error("Consulta não permitida para este perfil");
    Object.assign(error, { code: "BUSINESS_PERMISSION_DENIED", status: 403 });
    throw error;
  }
}
