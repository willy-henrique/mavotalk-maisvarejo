import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveOutboundEchoTarget,
  statusAfterInboundMessage,
} from "../../lib/conversation-state";

test("mensagem do cliente não devolve atendimento humano para a fila", () => {
  assert.equal(statusAfterInboundMessage("em_atendimento"), "em_atendimento");
});

test("mensagem abre ou reabre estados sem atendimento humano como aguardando", () => {
  assert.equal(statusAfterInboundMessage("aguardando"), "aguardando");
  assert.equal(statusAfterInboundMessage("pendente_cliente"), "aguardando");
  assert.equal(statusAfterInboundMessage("encerrado"), "aguardando");
});

// ---------------------------------------------------------------------------
// Eco de mensagem enviada pelo aparelho
//
// O aviso de encerramento e o agradecimento pela avaliação são enviados pelo
// próprio sistema e voltam do WhatsApp como `fromMe`. Sem esta regra, o eco não
// encontrava conversa aberta — porque o chamado acabara de ser encerrado — e
// abria uma nova em `aguardando` só para hospedar a própria despedida. O
// resultado aparecia para o operador como chamado fantasma na Caixa de entrada.
// ---------------------------------------------------------------------------

test("despedida do bot não abre chamado novo depois do encerramento", () => {
  const alvo = resolveOutboundEchoTarget({
    fromBot: true,
    latestConversation: { id: "conv-1", status: "encerrado" },
  });

  assert.deepEqual(alvo, { action: "attach", conversationId: "conv-1" });
});

test("mensagem do bot se anexa à conversa em aberto quando existe", () => {
  for (const status of ["aguardando", "em_atendimento", "pendente_cliente"] as const) {
    assert.deepEqual(
      resolveOutboundEchoTarget({
        fromBot: true,
        latestConversation: { id: "conv-2", status },
      }),
      { action: "attach", conversationId: "conv-2" },
    );
  }
});

test("mensagem do bot para contato sem histórico é descartada, não vira chamado", () => {
  const alvo = resolveOutboundEchoTarget({
    fromBot: true,
    latestConversation: null,
  });

  assert.deepEqual(alvo, {
    action: "skip",
    reason: "bot_message_without_conversation",
  });
});

test("resposta escrita por uma pessoa continua podendo abrir chamado", () => {
  // Atendente que fala com o cliente pelo próprio aparelho depois do encerramento
  // está iniciando um contato novo, e isso precisa de protocolo.
  assert.deepEqual(
    resolveOutboundEchoTarget({
      fromBot: false,
      latestConversation: { id: "conv-3", status: "encerrado" },
    }),
    { action: "open" },
  );

  assert.deepEqual(
    resolveOutboundEchoTarget({ fromBot: false, latestConversation: null }),
    { action: "open" },
  );
});
