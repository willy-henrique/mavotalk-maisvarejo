import { sendWhatsappMessage, getWhatsappState, initWhatsappClient, destroyWhatsappClient } from "@/lib/whatsapp-client";

export const WhatsAppService = {
  async send(toPhone: string, text: string, options?: { skipRateLimit?: boolean; mediaUrl?: string }) {
    return sendWhatsappMessage(toPhone, text, options);
  },

  getState() {
    return getWhatsappState();
  },

  async init() {
    return initWhatsappClient();
  },

  async destroy() {
    return destroyWhatsappClient();
  },
};
