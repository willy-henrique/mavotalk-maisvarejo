import { requireSession } from "@/lib/api";
import { getConversation } from "@/lib/repo";
import { sendTypingIndicator } from "@/lib/whatsapp-client";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const { id } = await context.params;
  const conversation = await getConversation(auth.session.organizationId, id);
  if (!conversation || !conversation.contactPhone) {
    return new Response(null, { status: 404 });
  }

  await sendTypingIndicator(conversation.contactPhone);
  return new Response(null, { status: 204 });
}
