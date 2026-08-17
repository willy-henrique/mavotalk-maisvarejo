import test from "node:test";
import assert from "node:assert/strict";
import {
  selectRecentWhatsappHistoryMessages,
  whatsappMessageTimestampSeconds,
} from "../../lib/whatsapp-message-history";

function message(
  id: string,
  timestamp: number,
  options?: { jid?: string; content?: unknown; broadcast?: boolean },
) {
  return {
    key: {
      id,
      remoteJid: options?.jid || "5511999990000@s.whatsapp.net",
    },
    message: options && "content" in options ? options.content : { conversation: id },
    messageTimestamp: timestamp,
    broadcast: options?.broadcast,
  };
}

test("seleciona histórico recente individual em ordem cronológica", () => {
  const now = 2_000_000;
  const selected = selectRecentWhatsappHistoryMessages(
    [
      message("newest", now - 10),
      message("oldest-selected", now - 30),
      message("middle", now - 20, { jid: "123456789012345@lid" }),
      message("too-old", now - 3_601),
      message("group", now - 5, { jid: "120363000000000@g.us" }),
      message("status", now - 4, { jid: "status@broadcast" }),
    ],
    { nowSeconds: now, maxAgeSeconds: 3_600, maxMessages: 10 },
  );

  assert.deepEqual(
    selected.map((item) => item.key.id),
    ["oldest-selected", "middle", "newest"],
  );
});

test("mantém apenas as mensagens mais novas quando o lote excede o teto", () => {
  const now = 3_000_000;
  const selected = selectRecentWhatsappHistoryMessages(
    [
      message("one", now - 40),
      message("two", now - 30),
      message("three", now - 20),
      message("four", now - 10),
    ],
    { nowSeconds: now, maxAgeSeconds: 3_600, maxMessages: 2 },
  );

  assert.deepEqual(
    selected.map((item) => item.key.id),
    ["three", "four"],
  );
});

test("descarta duplicadas, mensagens vazias, broadcast e timestamp inválido", () => {
  const now = 4_000_000;
  const selected = selectRecentWhatsappHistoryMessages(
    [
      message("duplicate", now - 2),
      message("duplicate", now - 1),
      message("empty", now - 3, { content: null }),
      message("broadcast", now - 4, { broadcast: true }),
      message("invalid-time", Number.NaN),
    ],
    { nowSeconds: now, maxAgeSeconds: 3_600, maxMessages: 20 },
  );

  assert.deepEqual(selected.map((item) => item.key.id), ["duplicate"]);
});

test("converte timestamp Long do protobuf sem perder o valor", () => {
  assert.equal(
    whatsappMessageTimestampSeconds({ toNumber: () => 1_725_000_123 }),
    1_725_000_123,
  );
});
