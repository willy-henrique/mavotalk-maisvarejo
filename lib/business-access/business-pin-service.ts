import bcrypt from "bcryptjs";
import { mavoConfig } from "@/lib/config/mavo-config";
import {
  recordBusinessAccessAudit,
  registerFailedPinAttempt,
  resetPinAttempts,
} from "@/lib/business-access/business-access-repository";
import type {
  BusinessAccessUser,
  MfaVerificationResult,
} from "@/lib/business-access/types";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";

export function validatePinFormat(pin: string): boolean {
  return /^\d{6,12}$/.test(pin);
}

export async function hashBusinessPin(pin: string): Promise<string> {
  if (!validatePinFormat(pin)) {
    throw new Error("O PIN deve conter de 6 a 12 dígitos");
  }
  return bcrypt.hash(pin, 12);
}

export async function verifyBusinessPin(
  user: BusinessAccessUser,
  pin: string,
  requestId?: string,
): Promise<MfaVerificationResult> {
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    return { ok: false, code: "LOCKED", lockedUntil: user.lockedUntil };
  }
  if (user.mfaType !== "pin") return { ok: false, code: "UNSUPPORTED" };
  if (!user.pinHash) return { ok: false, code: "NOT_CONFIGURED" };
  const limit = await consumeRateLimit(
    "business-pin",
    rateLimitSubject(`${user.organizationId}:${user.id}`),
    mavoConfig.pinMaxAttempts,
    60,
  );
  if (!limit.allowed) {
    return {
      ok: false,
      code: limit.unavailable ? "RATE_LIMIT_UNAVAILABLE" : "RATE_LIMITED",
    };
  }

  const validFormat = validatePinFormat(pin);
  const matches = validFormat && (await bcrypt.compare(pin, user.pinHash));
  if (!matches) {
    const attempt = await registerFailedPinAttempt(
      user.organizationId,
      user.id,
      mavoConfig.pinMaxAttempts,
      mavoConfig.pinLockMinutes,
    );
    await recordBusinessAccessAudit({
      organizationId: user.organizationId,
      accessUserId: user.id,
      phoneNormalized: user.phoneNormalized,
      eventType: attempt.lockedUntil
        ? "access_locked"
        : "authentication_failed",
      requestId,
      metadata: { failedAttempts: attempt.failedAttempts },
    });
    return attempt.lockedUntil
      ? { ok: false, code: "LOCKED", lockedUntil: attempt.lockedUntil }
      : { ok: false, code: "INVALID_CODE" };
  }

  await resetPinAttempts(user.organizationId, user.id);
  await recordBusinessAccessAudit({
    organizationId: user.organizationId,
    accessUserId: user.id,
    phoneNormalized: user.phoneNormalized,
    eventType: "authentication_succeeded",
    requestId,
  });
  return { ok: true };
}

export interface BusinessMfaProvider {
  readonly type: BusinessAccessUser["mfaType"];
  verify(
    user: BusinessAccessUser,
    code: string,
    requestId?: string,
  ): Promise<MfaVerificationResult>;
}

export const pinMfaProvider: BusinessMfaProvider = {
  type: "pin",
  verify: verifyBusinessPin,
};
