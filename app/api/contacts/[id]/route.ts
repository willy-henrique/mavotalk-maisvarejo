import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { updateContact } from "@/lib/repo";
import { updateContactSchema } from "@/lib/schemas";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const { id } = await context.params;
  const body = await request.json();
  const parsed = updateContactSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const payload: { name?: string; phoneNumber?: string; blocked?: boolean; internalNote?: string | null } = {};
  if (parsed.data.name !== undefined) payload.name = parsed.data.name;
  if (parsed.data.phoneNumber !== undefined) payload.phoneNumber = parsed.data.phoneNumber;
  if (parsed.data.blocked !== undefined) payload.blocked = parsed.data.blocked;
  if (parsed.data.internalNote !== undefined) payload.internalNote = parsed.data.internalNote;
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  const result = await updateContact(auth.session.organizationId, id, payload);

  if (!result) {
    return NextResponse.json({ error: "Contato nao encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    contact: {
      id: result.id,
      name: (result as { name?: string }).name,
      phoneNumber: (result as { phoneNumber?: string }).phoneNumber,
    },
  });
}
