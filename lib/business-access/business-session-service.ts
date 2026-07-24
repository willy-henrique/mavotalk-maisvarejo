import { createHash, randomBytes } from "node:crypto";
import { mavoConfig } from "@/lib/config/mavo-config";
import { permissionsForRole } from "@/lib/business-access/business-permissions";
import {
  createBusinessSession,
  findActiveBusinessSession,
  renewBusinessSession,
  revokeBusinessSessions,
} from "@/lib/business-access/business-access-repository";
import type {
  BusinessAccessContext,
  BusinessAccessSession,
  BusinessAccessUser,
} from "@/lib/business-access/types";

export function isBusinessSessionActive(
  session: Pick<BusinessAccessSession, "expiresAt" | "revokedAt">,
  now = new Date(),
): boolean {
  return !session.revokedAt && session.expiresAt > now;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function contextFor(
  user: BusinessAccessUser,
  sessionId: string,
  origin: BusinessAccessContext["origin"],
): BusinessAccessContext {
  return {
    organizationId: user.organizationId,
    accessUserId: user.id,
    phoneNormalized: user.phoneNormalized,
    name: user.name,
    role: user.role,
    permissions: permissionsForRole(user.role, user.permissions),
    sessionId,
    origin,
  };
}

export async function establishBusinessSession(
  user: BusinessAccessUser,
  origin: BusinessAccessContext["origin"] = "whatsapp",
): Promise<BusinessAccessContext> {
  const opaqueToken = randomBytes(32).toString("base64url");
  const session = await createBusinessSession({
    organizationId: user.organizationId,
    accessUserId: user.id,
    phoneNormalized: user.phoneNormalized,
    tokenHash: tokenHash(opaqueToken),
    ttlMinutes: mavoConfig.businessSessionTtlMinutes,
  });
  return contextFor(user, session.id, origin);
}

export async function getBusinessSessionContext(
  organizationId: string,
  phoneNormalized: string,
  origin: BusinessAccessContext["origin"] = "whatsapp",
): Promise<{
  context: BusinessAccessContext;
  supportMode: boolean;
  authenticated: boolean;
} | null> {
  const active = await findActiveBusinessSession(
    organizationId,
    phoneNormalized,
  );
  if (!active) return null;
  const supportMode =
    Boolean(active.session.supportModeUntil) &&
    active.session.supportModeUntil! > new Date();
  const authenticated = isBusinessSessionActive(active.session);
  if (!authenticated && !supportMode) return null;
  return {
    context: contextFor(active.user, active.session.id, origin),
    supportMode,
    authenticated,
  };
}

export async function renewAuthorizedBusinessSession(
  context: BusinessAccessContext,
): Promise<boolean> {
  return Boolean(
    await renewBusinessSession(
      context.organizationId,
      context.sessionId,
      mavoConfig.businessSessionTtlMinutes,
    ),
  );
}

export async function revokeBusinessAccessSession(
  context: BusinessAccessContext,
  reason = "user_logout",
): Promise<void> {
  await revokeBusinessSessions(
    context.organizationId,
    context.accessUserId,
    reason,
  );
}
