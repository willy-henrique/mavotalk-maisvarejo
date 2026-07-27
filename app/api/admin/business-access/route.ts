import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMenuPermission, requireSession } from "@/lib/api";
import {
  createBusinessAccessUser,
  listBusinessAccessUsers,
  recordBusinessAccessAudit,
} from "@/lib/business-access/business-access-repository";
import { hashBusinessPin } from "@/lib/business-access/business-pin-service";
import { normalizePhoneDigits } from "@/lib/utils";
import { requestIdFrom, sanitizedError } from "@/lib/observability";

const permissionSchema = z
  .object({
    "sales.read": z.boolean().optional(),
    "finance.read": z.boolean().optional(),
    "inventory.read": z.boolean().optional(),
    "audit.read": z.boolean().optional(),
    "access.manage": z.boolean().optional(),
  })
  .strict();

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    phone: z.string().min(8).max(40),
    role: z.enum(["owner", "director", "manager", "analyst"]),
    permissions: permissionSchema.default({}),
    pin: z.string().regex(/^\d{6,12}$/),
  })
  .strict();

function publicAccessUser<T extends { pinHash: unknown }>(
  user: T,
): Omit<T, "pinHash"> {
  const { pinHash, ...safe } = user;
  void pinHash;
  return safe;
}

export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_business_access", "read");
  if (denied) return denied;
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize")) || 25),
  );
  const result = await listBusinessAccessUsers(auth.session.organizationId, {
    page,
    pageSize,
  });
  return NextResponse.json({
    items: result.items.map(publicAccessUser),
    total: result.total,
    page,
    pageSize,
  });
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_business_access", "create");
  if (denied) return denied;
  const requestId = requestIdFrom(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido", requestId }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", requestId }, { status: 400 });
  }
  const phoneNormalized = normalizePhoneDigits(parsed.data.phone);
  if (!phoneNormalized) {
    return NextResponse.json({ error: "Telefone inválido", requestId }, { status: 400 });
  }
  try {
    const user = await createBusinessAccessUser({
      organizationId: auth.session.organizationId,
      name: parsed.data.name,
      phoneNormalized,
      role: parsed.data.role,
      permissions: parsed.data.permissions,
      pinHash: await hashBusinessPin(parsed.data.pin),
      createdByUserId: auth.session.userId,
    });
    await recordBusinessAccessAudit({
      organizationId: auth.session.organizationId,
      accessUserId: user.id,
      phoneNormalized,
      eventType: "access_created",
      source: "ui",
      requestId,
      metadata: { role: user.role },
    });
    return NextResponse.json({ user: publicAccessUser(user), requestId }, { status: 201 });
  } catch (error) {
    const code = String((error as { code?: string }).code || "");
    return NextResponse.json(
      {
        error:
          code === "23505"
            ? { code: "PHONE_ALREADY_AUTHORIZED", message: "Telefone já autorizado" }
            : sanitizedError(error),
        requestId,
      },
      { status: code === "23505" ? 409 : 500 },
    );
  }
}
