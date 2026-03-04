
import { GoogleGenAI } from "@google/genai";

// Initialize the Google GenAI client with the API key from environment variable process.env.API_KEY.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export class GeminiService {
  /**
   * Generates a suggested reply based on ticket subject and context.
   */
  static async suggestReply(subject: string, context: string): Promise<string> {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `
        Você é um Assistente de IA especialista em Suporte Técnico (HelpDesk).
        Seu objetivo é sugerir uma resposta profissional, empática e resolutiva para um agente de suporte.

        ASSUNTO DO TICKET: ${subject}
        HISTÓRICO RECENTE:
        ${context}

        Siga estas regras:
        1. Seja cordial.
        2. Tente resolver o problema ou pedir as informações necessárias de forma clara.
        3. Use um tom corporativo mas amigável.
        4. Retorne APENAS o texto da sugestão, sem introduções.
        `,
      });

      // Directly access the .text property as per SDK documentation.
      return response.text || "Não foi possível gerar uma sugestão no momento.";
    } catch (error) {
      console.error("Gemini Error:", error);
      return "Erro ao conectar com a IA de suporte.";
    }
  }

  /**
   * Summarizes a long conversation for quick hand-over.
   */
  static async summarizeConversation(context: string): Promise<string> {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Resuma esta conversa de suporte técnico em 3 pontos principais (bullets): \n\n ${context}`,
      });

      // Directly access the .text property as per SDK documentation.
      return response.text || "Resumo indisponível.";
    } catch (error) {
      return "Erro ao gerar resumo.";
    }
  }
}
