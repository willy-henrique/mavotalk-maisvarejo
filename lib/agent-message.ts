/**
 * Resolve o nome que aparece para o cliente sem permitir que espaços ou quebras de
 * linha do cadastro deformem a mensagem enviada pelo WhatsApp.
 */
function agentDisplayName(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/:+$/, "") || "Atendente";
}

/** Monta exatamente o texto que o cliente recebe no WhatsApp. */
export function buildAgentWhatsappMessage(
  content: string,
  authorName: string | null | undefined,
  withSignature: boolean,
): string {
  if (!withSignature) return content;
  return `${agentDisplayName(authorName)}:\n${content}`;
}

/** O valor escolhido no compositor prevalece sobre o padrão da organização. */
export function resolveAgentSignature(
  override: boolean | undefined,
  organizationDefault: boolean,
): boolean {
  return typeof override === "boolean" ? override : organizationDefault;
}
