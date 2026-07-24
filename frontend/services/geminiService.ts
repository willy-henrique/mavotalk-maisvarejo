import { apiPost } from './api';

type AssistResponse = { text?: string };

/**
 * Alias legado mantido para componentes antigos. Toda chamada sensível ocorre
 * no backend; nenhuma chave de IA é incluída no bundle Vite.
 */
export class GeminiService {
  static async suggestReply(subject: string, context: string): Promise<string> {
    try {
      const response = await apiPost<AssistResponse>('/api/ai/support-assist', {
        operation: 'suggest_reply',
        subject,
        context,
      });
      return response.text || 'Sugestão indisponível.';
    } catch {
      return 'Não foi possível gerar uma sugestão no momento.';
    }
  }

  static async summarizeConversation(context: string): Promise<string> {
    try {
      const response = await apiPost<AssistResponse>('/api/ai/support-assist', {
        operation: 'summarize',
        context,
      });
      return response.text || 'Resumo indisponível.';
    } catch {
      return 'Não foi possível gerar o resumo no momento.';
    }
  }
}
