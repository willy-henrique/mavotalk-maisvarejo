export type BusinessRole = "owner" | "director" | "manager" | "analyst";
export type BusinessMfaType = "pin" | "totp" | "email_code" | "external";

export type BusinessPermission =
  | "sales.read"
  | "finance.read"
  | "inventory.read"
  | "audit.read"
  | "access.manage";

export type BusinessAccessUser = {
  id: string;
  organizationId: string;
  name: string;
  phoneNormalized: string;
  role: BusinessRole;
  permissions: Partial<Record<BusinessPermission, boolean>>;
  pinHash: string | null;
  mfaType: BusinessMfaType;
  isActive: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastAccessAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BusinessAccessSession = {
  id: string;
  organizationId: string;
  accessUserId: string;
  phoneNormalized: string;
  authenticatedAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  supportModeUntil: Date | null;
  revokedAt: Date | null;
};

export type BusinessAccessContext = {
  organizationId: string;
  accessUserId: string;
  phoneNormalized: string;
  name: string;
  role: BusinessRole;
  permissions: ReadonlySet<BusinessPermission>;
  sessionId: string;
  origin: "whatsapp" | "ui" | "mcp" | "api";
};

export type MfaVerificationResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "INVALID_CODE"
        | "LOCKED"
        | "NOT_CONFIGURED"
        | "UNSUPPORTED"
        | "RATE_LIMITED"
        | "RATE_LIMIT_UNAVAILABLE";
      lockedUntil?: Date;
    };
