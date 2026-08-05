import test from "node:test";
import assert from "node:assert/strict";
import { matchMenuEntry, renderMenuOptions, type BotMenuEntry } from "../../lib/bot-menu";

/** Filas reais de um tenant de suporte de ERP: nomes livres e opções acima de 6. */
const entries: BotMenuEntry[] = [
  { queueId: "q1", menuOption: 1, name: "Tele Vendas", queueType: "custom" },
  { queueId: "q2", menuOption: 2, name: "Ofertas Anunciadas", queueType: "offers_promotions" },
  { queueId: "q3", menuOption: 3, name: "Administrativo", queueType: "custom" },
  { queueId: "q4", menuOption: 9, name: "Nota fiscal de Saída", queueType: "custom" },
  { queueId: "q5", menuOption: 12, name: "TEF / Cartão / PIX", queueType: "custom" },
];

test("o menu lista o nome real das filas, não um preset fixo", () => {
  const rendered = renderMenuOptions(entries);

  assert.match(rendered, /\*1\* - Tele Vendas/);
  assert.match(rendered, /\*2\* - Ofertas Anunciadas/);
  assert.doesNotMatch(rendered, /Açougue|hortifruti|Ofertas e promoções/);
});

test("filas com opção acima de 6 aparecem no menu", () => {
  const rendered = renderMenuOptions(entries);

  assert.match(rendered, /\*9\* - Nota fiscal de Saída/);
  assert.match(rendered, /\*12\* - TEF \/ Cartão \/ PIX/);
});

test("o menu respeita a ordem de menu_option", () => {
  const rendered = renderMenuOptions([...entries].reverse());
  const posicoes = ["Tele Vendas", "Ofertas Anunciadas", "Administrativo"].map((nome) =>
    rendered.indexOf(nome),
  );

  assert.deepEqual(posicoes, [...posicoes].sort((a, b) => a - b));
});

test("seleção por número funciona inclusive acima de 6", () => {
  assert.equal(matchMenuEntry("2", entries)?.queueId, "q2");
  assert.equal(matchMenuEntry("12", entries)?.queueId, "q5");
  assert.equal(matchMenuEntry("opcao 9", entries)?.queueId, "q4");
});

test("seleção pelo nome escrito, ignorando acento e caixa", () => {
  assert.equal(matchMenuEntry("Ofertas Anunciadas", entries)?.queueId, "q2");
  assert.equal(matchMenuEntry("ofertas anunciadas", entries)?.queueId, "q2");
  assert.equal(matchMenuEntry("NOTA FISCAL DE SAIDA", entries)?.queueId, "q4");
});

test("seleção por prefixo quando não há ambiguidade", () => {
  assert.equal(matchMenuEntry("ofertas", entries)?.queueId, "q2");
  assert.equal(matchMenuEntry("tele", entries)?.queueId, "q1");
});

test("prefixo ambíguo não escolhe fila nenhuma", () => {
  const ambiguas: BotMenuEntry[] = [
    { queueId: "a", menuOption: 1, name: "Nota fiscal de Entrada", queueType: "custom" },
    { queueId: "b", menuOption: 2, name: "Nota fiscal de Saída", queueType: "custom" },
  ];

  assert.equal(matchMenuEntry("nota fiscal", ambiguas), null);
});

test("número que não corresponde a nenhuma fila não vira seleção", () => {
  assert.equal(matchMenuEntry("7", entries), null);
  assert.equal(matchMenuEntry("99", entries), null);
});

test("texto solto não seleciona fila por acidente", () => {
  assert.equal(matchMenuEntry("bom dia, tudo bem?", entries), null);
});
