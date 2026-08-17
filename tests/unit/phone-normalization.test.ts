import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhoneDigits,
  toWhatsAppAddress,
  whatsappPhoneCandidates,
  whatsappPhoneStorageAliases,
} from "../../lib/utils";

test("normaliza telefones brasileiros e preserva E.164 sem símbolos", () => {
  assert.equal(normalizePhoneDigits("(11) 99999-1234"), "5511999991234");
  assert.equal(
    normalizePhoneDigits("whatsapp:+55 11 99999-1234"),
    "5511999991234",
  );
  assert.equal(normalizePhoneDigits("011 99999-1234"), "5511999991234");
  assert.equal(normalizePhoneDigits("0055 11 99999-1234"), "5511999991234");
  assert.equal(toWhatsAppAddress("(11) 99999-1234"), "whatsapp:+5511999991234");
});

test("gera candidatos brasileiros com e sem nono dígito sem perder o formato canônico", () => {
  assert.deepEqual(whatsappPhoneCandidates("11 99999-1234"), [
    "5511999991234",
    "551199991234",
  ]);
  assert.deepEqual(whatsappPhoneCandidates("55 11 8888-1234"), [
    "551188881234",
    "5511988881234",
  ]);
  assert.deepEqual(whatsappPhoneCandidates("+1 202 555 0147"), [
    "12025550147",
  ]);

  const aliases = whatsappPhoneStorageAliases("11 99999-1234");
  assert.ok(aliases.includes("5511999991234"));
  assert.ok(aliases.includes("whatsapp:+5511999991234"));
  assert.ok(aliases.includes("551199991234"));
  assert.ok(!aliases.includes("whatsapp:+551199991234"));
});

test("recusa identificadores que não podem ser um telefone", () => {
  assert.equal(normalizePhoneDigits("123"), "");
  assert.equal(normalizePhoneDigits(""), "");
  assert.equal(normalizePhoneDigits("1234567890123456"), "");
});
