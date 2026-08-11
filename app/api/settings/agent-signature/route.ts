import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { getSupermarketSettings } from "@/lib/supermarket-settings";

/**
 * Padrão da assinatura para o compositor do Inbox.
 *
 * A configuração vive em /api/admin/supermarket-settings, que é restrita a admin e
 * gestor. O atendente precisa apenas ler o padrão para o botão do compositor nascer
 * no estado correto, então esta rota exige somente acesso ao Inbox.
 */
export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "inbox", "read");
  if (denied) return denied;

  const { agentSignatureEnabled } = await getSupermarketSettings(
    auth.session.organizationId,
  );
  return NextResponse.json({ agentSignatureEnabled });
}
