import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deliverInOrder } from "../../lib/queue-automation-runtime";

const flyerSequence = [
  { text: "Ofertas da semana" },
  { text: "Encarte 1", mediaUrl: "https://res.cloudinary.com/dgi1nxtb0/a.png" },
  { text: "Encarte 2", mediaUrl: "https://res.cloudinary.com/dgi1nxtb0/b.png" },
  { text: "Digite *0* para voltar ao menu." },
];

test("entrega a sequência de ofertas na ordem em que foi montada", async () => {
  const sent: string[] = [];
  const delivered = await deliverInOrder(flyerSequence, async (message) => {
    await new Promise((resolve) => setTimeout(resolve, message.text === "Ofertas da semana" ? 20 : 0));
    sent.push(message.text);
    return true;
  });

  assert.equal(delivered, true);
  assert.deepEqual(sent, ["Ofertas da semana", "Encarte 1", "Encarte 2", "Digite *0* para voltar ao menu."]);
});

test("um flyer que falha não impede o restante da sequência", async () => {
  const sent: string[] = [];
  const delivered = await deliverInOrder(flyerSequence, async (message) => {
    if (message.text === "Encarte 1") throw new Error("timeout do provedor");
    sent.push(message.text);
    return true;
  });

  assert.equal(delivered, false);
  assert.deepEqual(sent, ["Ofertas da semana", "Encarte 2", "Digite *0* para voltar ao menu."]);
});

test("a rota do webhook entrega a sequência em ordem, sem Promise.all", async () => {
  const route = await readFile("app/api/webhooks/n8n/ticket-upsert/route.ts", "utf8");
  assert.match(route, /deliverInOrder\(/);
  assert.doesNotMatch(route, /Promise\.all\(messages\.map/);
});
