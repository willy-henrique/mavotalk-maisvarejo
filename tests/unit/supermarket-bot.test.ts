import test from "node:test";
import assert from "node:assert/strict";
import {
  decideSupermarketBot,
  type DecideSupermarketBotParams,
  type SupermarketBotConfig,
} from "../../lib/supermarket-bot";

const completeConfig: SupermarketBotConfig = {
  enabled: true,
  botName: "Mavi",
  storeName: "Mercado Teste",
  address: "Rua Teste, 123",
  mapsUrl: "https://maps.example/mercado",
  weekdayHours: "Segunda a sábado: 07h às 21h",
  sundayHours: "Domingos: 08h às 14h",
  offersUrl: "https://mercado.example/ofertas",
  orderUrl: "https://mercado.example/pedidos",
  deliveryInfo: "Entregas em toda a cidade.",
  phone: "(11) 3333-4444",
  aiFallbackEnabled: false,
};

function decide(
  overrides: Partial<DecideSupermarketBotParams>,
  config: SupermarketBotConfig = completeConfig,
) {
  return decideSupermarketBot({
    message: "oi",
    customerName: "Cliente",
    isNewConversation: false,
    triageCompleted: false,
    currentQueueMenuOption: null,
    businessOpen: true,
    config,
    ...overrides,
  });
}

test("apresenta o menu completo e informa a disponibilidade da equipe", () => {
  const decision = decide({ message: "Olá", customerName: "Ana Silva" });

  assert.equal(decision?.kind, "menu");
  assert.match(decision?.replyText || "", /Boa (dia|tarde|noite), Ana!/);
  assert.match(decision?.replyText || "", /\*1\* - Ofertas e promoções/);
  assert.match(decision?.replyText || "", /\*7\* - Falar com um atendente/);
  assert.match(decision?.replyText || "", /equipe está disponível agora/);
});

test("resolve ofertas por autoatendimento quando o link está configurado", () => {
  const decision = decide({ message: "Quais são as promoções de hoje?" });

  assert.equal(decision?.kind, "self-service");
  assert.equal(decision?.queueMenuOption, null);
  assert.equal(decision?.triageCompleted, false);
  assert.match(decision?.replyText || "", /https:\/\/mercado\.example\/ofertas/);
});

test("encaminha para a fila correta quando falta configuração de autoatendimento", () => {
  const decision = decide(
    { message: "1" },
    { ...completeConfig, offersUrl: null },
  );

  assert.equal(decision?.kind, "human-handoff");
  assert.equal(decision?.queueMenuOption, 1);
  assert.equal(decision?.triageCompleted, true);
  assert.equal(decision?.appendOutOfHours, true);
  assert.match(decision?.reason || "", /missing_self_service_config_1/);
});

test("coleta produto e conclui a triagem com o contexto informado", () => {
  const first = decide({ message: "Quanto custa esse produto?" });
  assert.equal(first?.kind, "collect-details");
  assert.equal(first?.queueMenuOption, 4);
  assert.equal(first?.triageCompleted, false);

  const second = decide({
    message: "Café Melitta, pacote de 500 g",
    currentQueueMenuOption: 4,
  });
  assert.equal(second?.kind, "human-handoff");
  assert.equal(second?.queueMenuOption, 4);
  assert.equal(second?.triageCompleted, true);
  assert.match(second?.replyText || "", /Café Melitta, pacote de 500 g/);
});

test("não repete respostas automáticas depois que a conversa aguarda uma pessoa", () => {
  const decision = decide({
    message: "Ainda estou aguardando",
    triageCompleted: true,
    currentQueueMenuOption: 7,
  });

  assert.equal(decision?.kind, "silent-human");
  assert.equal(decision?.replyText, null);
});

test("permite fallback externo somente quando habilitado", () => {
  const decision = decide(
    { message: "uma intenção totalmente desconhecida" },
    { ...completeConfig, aiFallbackEnabled: true },
  );

  assert.equal(decision, null);
});

test("não intercepta mensagens quando o bot está desabilitado", () => {
  const decision = decide(
    { message: "oi" },
    { ...completeConfig, enabled: false },
  );

  assert.equal(decision, null);
});
