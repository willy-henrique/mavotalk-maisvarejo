import test from "node:test";
import assert from "node:assert/strict";
import {
  isDirectUserJid,
  resolvePhoneJid,
  whatsappPhoneFromJid,
} from "../../lib/whatsapp-addressing";

test("usa o PN alternativo quando o Baileys entrega a conversa por LID", async () => {
  const phoneJid = await resolvePhoneJid({
    remoteJid: "123456789012345@lid",
    remoteJidAlt: "5511999991234@s.whatsapp.net",
  });

  assert.equal(phoneJid, "5511999991234@s.whatsapp.net");
  assert.equal(
    whatsappPhoneFromJid(phoneJid),
    "whatsapp:+5511999991234",
  );
});

test("consulta o mapeamento do Signal quando remoteJidAlt não veio", async () => {
  const phoneJid = await resolvePhoneJid(
    { remoteJid: "123456789012345@lid" },
    async (lid) =>
      lid === "123456789012345@lid"
        ? "5511988884321@s.whatsapp.net"
        : null,
  );

  assert.equal(phoneJid, "5511988884321@s.whatsapp.net");
});

test("nunca converte o identificador LID em número de telefone", async () => {
  assert.equal(isDirectUserJid("123456789012345@lid"), true);
  assert.equal(
    whatsappPhoneFromJid("123456789012345@lid"),
    null,
  );
  assert.equal(
    await resolvePhoneJid({ remoteJid: "123456789012345@lid" }),
    null,
  );
});
