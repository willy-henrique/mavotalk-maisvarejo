import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhoneDigits,
  toWhatsAppAddress,
} from "../../lib/utils";

test("normaliza telefones brasileiros e preserva E.164 sem símbolos", () => {
  assert.equal(normalizePhoneDigits("(11) 99999-1234"), "5511999991234");
  assert.equal(
    normalizePhoneDigits("whatsapp:+55 11 99999-1234"),
    "5511999991234",
  );
  assert.equal(normalizePhoneDigits("011 99999-1234"), "5511999991234");
  assert.equal(toWhatsAppAddress("(11) 99999-1234"), "whatsapp:+5511999991234");
});

test("recusa identificadores que não podem ser um telefone", () => {
  assert.equal(normalizePhoneDigits("123"), "");
  assert.equal(normalizePhoneDigits(""), "");
  assert.equal(normalizePhoneDigits("1234567890123456"), "");
});
