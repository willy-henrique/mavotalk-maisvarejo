import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { getContactById, getOrCreateOpenConversation } from "@/lib/repo";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "contacts", "create");
  if (denied) return denied;

  const { id } = await context.params;
  const contact = await getContactById(auth.session.organizationId, id);
  if (!contact) {
    return NextResponse.json({ error: "Contato nao encontrado" }, { status: 404 });
  }

  if (!contact.phoneNumber) {
    return NextResponse.json(
      { error: "Contato sem numero de telefone" },
      { status: 400 },
    );
  }

  const conversation = await getOrCreateOpenConversation(
    auth.session.organizationId,
    contact.id,
    contact.phoneNumber,
  );

  return NextResponse.json({ conversationId: conversation.id }, { status: 201 });
}
