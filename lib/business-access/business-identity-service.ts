import { mavoConfig } from "@/lib/config/mavo-config";
import { normalizePhoneDigits } from "@/lib/utils";
import {
  findBusinessAccessUserByPhone,
  recordBusinessAccessAudit,
} from "@/lib/business-access/business-access-repository";
import { getBusinessSessionContext } from "@/lib/business-access/business-session-service";

export async function identifyBusinessPhone(
  organizationId: string,
  rawPhone: string,
  requestId?: string,
) {
  if (!mavoConfig.businessAccessEnabled) {
    return { kind: "support" as const, phoneNormalized: normalizePhoneDigits(rawPhone) };
  }

  const phoneNormalized = normalizePhoneDigits(rawPhone);
  if (!phoneNormalized) {
    return { kind: "support" as const, phoneNormalized: "" };
  }

  const user = await findBusinessAccessUserByPhone(
    organizationId,
    phoneNormalized,
  );
  if (!user || !user.isActive) {
    return { kind: "support" as const, phoneNormalized };
  }

  const session = await getBusinessSessionContext(
    organizationId,
    phoneNormalized,
    "whatsapp",
  );
  if (session?.supportMode) {
    return {
      kind: "support" as const,
      phoneNormalized,
      authorizedUser: user,
      businessSession: session.context,
      businessSessionAuthenticated: session.authenticated,
    };
  }
  if (session) {
    return {
      kind: "business" as const,
      phoneNormalized,
      user,
      context: session.context,
    };
  }

  await recordBusinessAccessAudit({
    organizationId,
    accessUserId: user.id,
    phoneNormalized,
    eventType: "challenge_requested",
    requestId,
  });
  return { kind: "challenge" as const, phoneNormalized, user };
}
