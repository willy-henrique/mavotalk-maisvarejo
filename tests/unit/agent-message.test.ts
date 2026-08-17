import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentWhatsappMessage,
  resolveAgentSignature,
} from "../../lib/agent-message";

test("assinatura coloca o nome do atendente acima da mensagem", () => {
  assert.equal(
    buildAgentWhatsappMessage("Olá, como posso ajudar?", "  Maria Silva:  ", true),
    "Maria Silva:\nOlá, como posso ajudar?",
  );
});

test("assinatura desligada preserva exatamente o texto digitado", () => {
  const content = "Primeira linha\nSegunda linha";
  assert.equal(buildAgentWhatsappMessage(content, "Maria", false), content);
});

test("escolha do compositor prevalece sobre o padrão da organização", () => {
  assert.equal(resolveAgentSignature(true, false), true);
  assert.equal(resolveAgentSignature(false, true), false);
  assert.equal(resolveAgentSignature(undefined, true), true);
});
