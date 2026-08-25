import twilio from "twilio";
import { sendWhatsappMessage } from "@/lib/whatsapp-client";

function telefoneValido(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");
  if (!/^[0-9]{10,15}$/.test(digitos)) throw new Error("Destino de recuperação inválido");
  return digitos;
}

function urlDeRedefinicao(token: string): string {
  const base = process.env.MAVO_MANAGEMENT_URL;
  if (!base) throw new Error("MAVO_MANAGEMENT_URL não configurada");

  const url = new URL(base);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !local) || url.username || url.password) {
    throw new Error("MAVO_MANAGEMENT_URL inválida");
  }
  url.pathname = "/redefinir";
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", token);
  return url.toString();
}

function enderecoTwilio(numero: string): string {
  return numero.startsWith("whatsapp:") ? numero : `whatsapp:${numero}`;
}

export async function entregarRecuperacaoPorWhatsApp(
  telefone: string,
  token: string,
): Promise<void> {
  const destino = telefoneValido(telefone);
  const link = urlDeRedefinicao(token);
  const mensagem = [
    "Mavo Gerenciamento — redefinição de senha",
    "",
    "Use o link abaixo em até 30 minutos:",
    link,
    "",
    "Se você não pediu esta alteração, ignore esta mensagem.",
  ].join("\n");

  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  if (provider === "unofficial") {
    await sendWhatsappMessage(destino, mensagem, { skipRateLimit: true, fromBot: true });
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const remetente = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!accountSid || !authToken || !remetente) {
    throw new Error("Canal WhatsApp não configurado");
  }
  await twilio(accountSid, authToken).messages.create({
    from: enderecoTwilio(remetente),
    to: enderecoTwilio(destino),
    body: mensagem,
  });
}
