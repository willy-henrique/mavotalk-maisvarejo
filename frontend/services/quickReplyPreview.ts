const previewValues = (now: Date) => {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Sao_Paulo',
  }).format(now));
  const greeting = hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';

  return {
    saudacao: greeting,
    user: 'Ana, da equipe Mavo',
    cliente: 'Maria Silva',
    primeiro_nome: 'Maria',
    ticket: '#1234',
    data: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(now),
    hora: new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'America/Sao_Paulo',
    }).format(now),
  };
};

/** Renderização local, apenas para a prévia de edição; não altera a mensagem salva. */
export function renderQuickReplyPreview(content: string, now = new Date()): string {
  const values = previewValues(now);
  return content.replace(/\{(saudacao|user|cliente|primeiro_nome|ticket|data|hora)\}/g, (_match, key: keyof typeof values) => values[key]);
}
