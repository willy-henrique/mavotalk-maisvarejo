import test from "node:test";
import assert from "node:assert/strict";
import {
  decideSupermarketBot,
  type DecideSupermarketBotParams,
  type SupermarketBotConfig,
} from "../../lib/supermarket-bot";
import type { BotMenuEntry } from "../../lib/bot-menu";

const completeConfig: SupermarketBotConfig = {
  enabled: true,
  botName: "Mavo",
  storeName: "Mercado Teste",
  address: "Rua Teste, 123",
  mapsUrl: "https://maps.example/mercado",
  weekdayHours: "Segunda a sábado: 07h às 21h",
  sundayHours: "Domingos: 08h às 14h",
  offersUrl: "https://mercado.example/ofertas",
  offersText: "Ofertas do dia no Mercado Teste.",
  offersImageUrl: "https://cdn.example/ofertas.png",
  offersImagePublicId: "willtalk/offers/ofertas",
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
  assert.match(decision?.replyText || "", /(Bom dia|Boa tarde|Boa noite), Ana!/);
  assert.match(decision?.replyText || "", /\*1\* - Ofertas e promoções/);
  assert.match(decision?.replyText || "", /\*6\* - Falar com um atendente/);
  assert.doesNotMatch(decision?.replyText || "", /Entregas|Pedidos/);
  assert.match(decision?.replyText || "", /equipe está disponível agora/);
});

test("resolve ofertas por autoatendimento quando o link está configurado", () => {
  const decision = decide({ message: "Quais são as promoções de hoje?" });

  assert.equal(decision?.kind, "self-service");
  assert.equal(decision?.queueMenuOption, null);
  assert.equal(decision?.triageCompleted, false);
  assert.match(decision?.replyText || "", /Ofertas do dia/);
  assert.match(decision?.replyText || "", /Mercado Teste/);
  assert.equal(decision?.mediaUrl, "https://cdn.example/ofertas.png");
});

test("encaminha para a fila correta quando falta configuração de autoatendimento", () => {
  const decision = decide(
    { message: "1" },
    { ...completeConfig, offersUrl: null, offersText: null, offersImageUrl: null },
  );

  assert.equal(decision?.kind, "human-handoff");
  assert.equal(decision?.queueMenuOption, 1);
  assert.equal(decision?.triageCompleted, true);
  assert.equal(decision?.appendOutOfHours, true);
  assert.match(decision?.reason || "", /missing_self_service_config_offers/);
});

test("coleta produto e conclui a triagem com o contexto informado", () => {
  const first = decide({ message: "Quanto custa esse produto?" });
  assert.equal(first?.kind, "collect-details");
  assert.equal(first?.queueMenuOption, 3);
  assert.equal(first?.triageCompleted, false);

  const second = decide({
    message: "Café Melitta, pacote de 500 g",
    currentQueueMenuOption: 3,
  });
  assert.equal(second?.kind, "human-handoff");
  assert.equal(second?.queueMenuOption, 3);
  assert.equal(second?.triageCompleted, true);
  assert.match(second?.replyText || "", /Café Melitta, pacote de 500 g/);
  assert.match(second?.replyText || "", /Mercado Teste/);
});

test("mantém o nome configurado da loja nas respostas de localização e triagem", () => {
  const location = decide({ message: "qual o horário de funcionamento?" });
  const product = decide({ message: "tem o produto arroz?" });

  assert.match(location?.replyText || "", /Horários e localização · Mercado Teste/);
  assert.match(product?.replyText || "", /Consulta de produto · Mercado Teste/);
});

test("não repete respostas automáticas depois que a conversa aguarda uma pessoa", () => {
  const decision = decide({
    message: "Ainda estou aguardando",
    triageCompleted: true,
    currentQueueMenuOption: 6,
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

test("instrui o cliente a digitar o número da opção desejada", () => {
  const decision = decide({ message: "oi" });

  assert.match(decision?.replyText || "", /Digite o \*número\* da opção desejada/);
});

test("fila desativada some do menu e deixa de ser uma opção válida", () => {
  const menu = decide({ message: "menu", activeMenuOptions: [1, 2, 3, 4, 6] });
  assert.doesNotMatch(menu?.replyText || "", /Trocas, devoluções e pagamentos/);
  assert.match(menu?.replyText || "", /\*4\* - Açougue, padaria e hortifruti/);

  const selection = decide({ message: "5", activeMenuOptions: [1, 2, 3, 4, 6] });
  assert.equal(selection?.kind, "menu");
  assert.doesNotMatch(selection?.replyText || "", /Trocas, devoluções e pagamentos/);
});

test("falar com atendente continua disponível mesmo se a opção 6 estiver fora da lista ativa", () => {
  const decision = decide({ message: "6", activeMenuOptions: [1, 2, 3, 4, 5] });
  assert.equal(decision?.kind, "human-handoff");
  assert.equal(decision?.queueMenuOption, 6);
});

// ── Menu derivado das filas do tenant ────────────────────────────────
// O preset de supermercado deixa de ser a fonte de verdade: o cliente vê o
// nome cadastrado no painel e o comportamento segue o queue_type da fila.

const filasDoTenant: BotMenuEntry[] = [
  { queueId: "q-tele", menuOption: 1, name: "Tele Vendas", queueType: "custom" },
  { queueId: "q-ofertas", menuOption: 2, name: "Ofertas Anunciadas", queueType: "offers_promotions" },
  { queueId: "q-adm", menuOption: 3, name: "Administrativo", queueType: "custom" },
  { queueId: "q-nf", menuOption: 9, name: "Nota fiscal de Saída", queueType: "custom" },
];

test("o menu mostra as filas do tenant, não o preset de supermercado", () => {
  const decision = decide({ message: "menu", menuEntries: filasDoTenant });

  assert.equal(decision?.kind, "menu");
  assert.match(decision?.replyText || "", /\*1\* - Tele Vendas/);
  assert.match(decision?.replyText || "", /\*9\* - Nota fiscal de Saída/);
  assert.doesNotMatch(decision?.replyText || "", /Açougue|hortifruti/);
});

test("ofertas disparam pelo queue_type mesmo fora da posição 1", () => {
  const decision = decide({ message: "2", menuEntries: filasDoTenant });

  assert.equal(decision?.kind, "self-service");
  assert.equal(decision?.queueId, "q-ofertas");
  assert.equal(decision?.queueType, "offers_promotions");
  assert.match(decision?.reason || "", /self_service_offers/);
});

test("a fila da posição 1 deixa de ser oferta quando é uma fila comum", () => {
  const decision = decide({ message: "1", menuEntries: filasDoTenant });

  assert.equal(decision?.kind, "collect-details");
  assert.equal(decision?.queueId, "q-tele");
  assert.match(decision?.replyText || "", /Tele Vendas/);
});

test("o cliente pode escolher escrevendo o nome da opção", () => {
  const decision = decide({ message: "Ofertas Anunciadas", menuEntries: filasDoTenant });

  assert.equal(decision?.kind, "self-service");
  assert.equal(decision?.queueId, "q-ofertas");
});

test("filas acima da opção 6 são selecionáveis", () => {
  const decision = decide({ message: "9", menuEntries: filasDoTenant });

  assert.equal(decision?.kind, "collect-details");
  assert.equal(decision?.queueId, "q-nf");
});

test("com filas do tenant, o 6 não é mais atalho fixo para atendente", () => {
  const decision = decide({ message: "6", menuEntries: filasDoTenant });

  assert.equal(decision?.kind, "menu");
});

test("pedir atendente por escrito continua encaminhando para uma pessoa", () => {
  const decision = decide({ message: "quero falar com atendente", menuEntries: filasDoTenant });

  assert.equal(decision?.kind, "human-handoff");
});

test("numero fora do menu avisa que a opcao nao existe", () => {
  // Reenviar so o menu, com a saudacao, parecia recomeco de conversa e nao dizia que
  // a escolha era invalida - o cliente tendia a repetir o mesmo numero.
  const decision = decide({ message: "5", menuEntries: filasDoTenant });

  assert.equal(decision?.kind, "menu");
  assert.equal(decision?.reason, "supermarket_invalid_option");
  assert.match(String(decision?.replyText), /Nao encontrei essa opcao|Não encontrei essa opção/);
});

test("mensagem de opcao invalida configurada substitui o texto padrao", () => {
  const decision = decide(
    // 7 não existe no fixture; 9 é a fila de nota fiscal e seria escolha válida.
    { message: "7", menuEntries: filasDoTenant },
    { ...completeConfig, invalidOptionMessage: "Opa, essa opcao nao existe por aqui." },
  );

  assert.match(String(decision?.replyText), /Opa, essa opcao nao existe por aqui\./);
  assert.doesNotMatch(String(decision?.replyText), /Não encontrei essa opção/);
});

test("menu pedido de propósito nao leva aviso de opcao invalida", () => {
  // Guarda contra acusar erro de quem so quis rever as opcoes.
  for (const message of ["0", "menu", "bom dia"]) {
    const decision = decide({ message, menuEntries: filasDoTenant });
    assert.equal(decision?.reason, "supermarket_main_menu", `"${message}" nao e opcao invalida`);
    assert.doesNotMatch(String(decision?.replyText), /Não encontrei essa opção/);
  }
});

test("agradecimento nao e tratado como opcao invalida", () => {
  // O cliente dizia "Obrigada" e recebia "Nao encontrei essa opcao" com o menu inteiro.
  for (const message of ["Obrigada", "obrigado", "valeu", "ok", "beleza"]) {
    const decision = decide({ message, menuEntries: filasDoTenant });
    assert.equal(decision?.reason, "supermarket_courtesy_closing", `"${message}" nao e opcao invalida`);
    assert.doesNotMatch(String(decision?.replyText), /Não encontrei essa opção/);
    assert.equal(decision?.triageCompleted, true);
  }
});

test("em conversa nova a cortesia nao substitui a apresentacao", () => {
  const decision = decide({ message: "ok", menuEntries: filasDoTenant, isNewConversation: true });

  assert.notEqual(decision?.reason, "supermarket_courtesy_closing");
});

test("o menu para de ser reexibido depois do teto de tentativas", () => {
  // Sem teto, qualquer texto fora do menu reabria o menu indefinidamente.
  const primeira = decide({ message: "7", menuEntries: filasDoTenant, menuAttempts: 0 });
  assert.equal(primeira?.reason, "supermarket_invalid_option");

  const seguinte = decide({ message: "7", menuEntries: filasDoTenant, menuAttempts: 1 });
  assert.equal(seguinte?.reason, "supermarket_menu_attempts_exhausted");
  assert.equal(seguinte?.kind, "human-handoff");
  assert.equal(seguinte?.triageCompleted, true);
  assert.doesNotMatch(String(seguinte?.replyText), /Ofertas Anunciadas/);
});

test("com atendimento puxado por uma pessoa, o bot nao responde nada", () => {
  // Sem esta regra o menu voltava a cada mensagem do cliente, por cima do atendente,
  // porque a triagem seguia aberta depois do "puxar atendimento".
  const decision = decide({
    message: "ainda preciso de ajuda",
    menuEntries: filasDoTenant,
    humanHandled: true,
  });

  assert.equal(decision?.kind, "silent-human");
  assert.equal(decision?.replyText, null);
  assert.equal(decision?.triageCompleted, true);
});

test("saudacao e numero nao reabrem o menu enquanto uma pessoa atende", () => {
  // "bom dia" e um numero digitado sao atalhos de menu; precisam ceder ao atendente,
  // senao o cliente recebe o menu no meio de uma conversa humana.
  for (const message of ["bom dia", "0", "2", "menu"]) {
    const decision = decide({ message, menuEntries: filasDoTenant, humanHandled: true });
    assert.equal(decision?.kind, "silent-human", `"${message}" nao deveria reabrir o menu`);
  }
});

test("sem atendimento humano o menu continua funcionando", () => {
  // Guarda contra silenciar o bot por engano: humanHandled ausente nao muda nada.
  const decision = decide({ message: "bom dia", menuEntries: filasDoTenant });

  assert.equal(decision?.kind, "menu");
});
