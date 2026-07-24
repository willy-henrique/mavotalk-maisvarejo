import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, requireSession } from "@/lib/api";
import {
  getBusinessAccessUser,
  recordBusinessAccessAudit,
  revokeBusinessSessions,
  updateBusinessAccessUser,
} from "@/lib/business-access/business-access-repository";
import { normalizePhoneDigits } from "@/lib/utils";
import { requestIdFrom, sanitizedError } from "@/lib/observability";

const schema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    phone: z.string().min(8).max(40).optional(),
    role: z.enum(["owner", "director", "manager", "analyst"]).optional(),
    permissions: z
      .record(
        z.enum([
          "sales.read",
          "finance.read",
          "inventory.read",
          "audit.read",
          "access.manage",
        ]),
        z.boolean(),
      )
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nenhum campo informado");

function publicUser<T extends { pinHash: unknown }>(user: T): Omit<T, "pinHash"> {
  const { pinHash, ...safe } = user;
  void pinHash;
  return safe;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = requireRole(["admin"], auth.session.role);
  if (denied) return denied;
  const requestId = requestIdFrom(request);
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido", requestId }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", requestId }, { status: 400 });
  }
  const phoneNormalized =
    parsed.data.phone === undefined
      ? undefined
      : normalizePhoneDigits(parsed.data.phone);
  if (parsed.data.phone !== undefined && !phoneNormalized) {
    return NextResponse.json({ error: "Telefone inválido", requestId }, { status: 400 });
  }
  try {
    const user = await updateBusinessAccessUser(
      auth.session.organizationId,
      id,
      {
        name: parsed.data.name,
        phoneNormalized,
        role: parsed.data.role,
        permissions: parsed.data.permissions,
        isActive: parsed.data.isActive,
      },
    );
    if (!user) {
      return NextResponse.json({ error: "Acesso não encontrado", requestId }, { status: 404 });
    }
    if (parsed.data.isActive === false) {
      await revokeBusinessSessions(
        auth.session.organizationId,
        id,
        "access_deactivated",
      );
    }
    await recordBusinessAccessAudit({
      organizationId: auth.session.organizationId,
      accessUserId: id,
      phoneNormalized: user.phoneNormalized,
      eventType:
        parsed.data.isActive === false ? "access_deactivated" : "access_updated",
      source: "ui",
      requestId,
      metadata: { fieldsChanged: Object.keys(parsed.data).length },
    });
    return NextResponse.json({ user: publicUser(user), requestId });
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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = requireRole(["admin"], auth.session.role);
  if (denied) return denied;
  const { id } = await context.params;
  const requestId = requestIdFrom(request);
  const existing = await getBusinessAccessUser(auth.session.organizationId, id);
  if (!existing) {
    return NextResponse.json({ error: "Acesso não encontrado", requestId }, { status: 404 });
  }
  await updateBusinessAccessUser(auth.session.organizationId, id, {
    isActive: false,
  });
  await revokeBusinessSessions(
    auth.session.organizationId,
    id,
    "access_deactivated",
  );
  await recordBusinessAccessAudit({
    organizationId: auth.session.organizationId,
    accessUserId: id,
    phoneNormalized: existing.phoneNormalized,
    eventType: "access_deactivated",
    source: "ui",
    requestId,
  });
  return NextResponse.json({ deactivated: true, requestId });
}
