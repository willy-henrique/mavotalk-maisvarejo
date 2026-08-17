import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { countWhatsappDirectory } from "@/lib/repo";
import {
  resyncWhatsappContacts,
  waitForWhatsappContactAvatarSync,
} from "@/lib/whatsapp-client";
import { logger } from "@/lib/logger";

/** Tempo aguardando os eventos de contato chegarem depois do resync. */
const SETTLE_TIMEOUT_MS = Number(process.env.CONTACT_SYNC_SETTLE_MS) || 12_000;
const SETTLE_POLL_MS = 750;

export async function POST() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "contacts", "update");
  if (denied) return denied;

  const organizationId = auth.session.organizationId;
  const before = await countWhatsappDirectory(organizationId).catch(() => 0);

  try {
    await resyncWhatsappContacts();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível sincronizar os contatos.";
    logger.warn({ err: error, organizationId }, "Failed to resync WhatsApp contacts");
    // Pré-condição (WhatsApp desconectado, provedor diferente): o painel mostra a
    // mensagem ao operador em vez de um erro genérico.
    return NextResponse.json({ error: message }, { status: 422 });
  }

  // A gravação acontece nos listeners do socket, não aqui. Sem esperar, a resposta
  // sairia antes dos contatos chegarem e o operador veria "0 sincronizados" mesmo
  // com a sincronização em curso.
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let total = before;
  let stableFor = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    const current = await countWhatsappDirectory(organizationId).catch(() => total);
    if (current === total) {
      stableFor += SETTLE_POLL_MS;
      // Dois ciclos sem mudança: a carga chegou ao fim e não vale seguir esperando.
      if (total > before && stableFor >= SETTLE_POLL_MS * 2) break;
    } else {
      stableFor = 0;
      total = current;
    }
  }

  // A consulta de fotos usa poucas requisições em paralelo para não pressionar a
  // sessão do WhatsApp. Aguarda um pouco, mas não prende o request por uma agenda
  // grande; o restante continua no processo e aparece ao atualizar a lista.
  const avatars = await waitForWhatsappContactAvatarSync(3_000);
  logger.info({ organizationId, before, total, avatars }, "WhatsApp contacts resynced");
  return NextResponse.json({
    synced: total,
    added: Math.max(0, total - before),
    // O aparelho pode continuar enviando dados depois desta resposta; o painel
    // informa isso em vez de afirmar um total definitivo.
    pending: total === before,
    avatars,
  });
}
