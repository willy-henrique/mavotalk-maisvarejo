import test from "node:test";
import assert from "node:assert/strict";
import { buildOutboundMediaContent } from "../../lib/outbound-media-content";

const URL_AUDIO = "https://res.cloudinary.com/dgi1nxtb0/video/upload/v1/willtalk/messages/abc.ogg";
const URL_IMAGEM = "https://res.cloudinary.com/dgi1nxtb0/image/upload/v1/willtalk/messages/foto.jpg";
const URL_PDF = "https://res.cloudinary.com/dgi1nxtb0/raw/upload/v1/willtalk/messages/nota.pdf";

test("áudio sai como nota de voz, não como arquivo anexado", () => {
  // Sem ptt o WhatsApp entrega um arquivo que o cliente precisa baixar para
  // ouvir — e atendimento por voz que exige download não é atendimento por voz.
  const content = buildOutboundMediaContent(URL_AUDIO, undefined, {
    mimeType: "audio/ogg",
  }) as { audio: { url: string }; mimetype: string; ptt: boolean };

  assert.equal(content.audio.url, URL_AUDIO);
  assert.equal(content.mimetype, "audio/ogg");
  assert.equal(content.ptt, true);
});

test("a duração vai junto quando o remetente já sabe", () => {
  const content = buildOutboundMediaContent(URL_AUDIO, undefined, {
    mimeType: "audio/ogg",
    seconds: 12.6,
  }) as { seconds?: number };

  assert.equal(content.seconds, 13);
});

test("sem duração conhecida, o campo não é inventado", () => {
  // O Baileys calcula sozinho a partir do arquivo. Mandar zero seria pior que
  // omitir: o player mostraria uma nota de voz de duração nula.
  const content = buildOutboundMediaContent(URL_AUDIO, undefined, {
    mimeType: "audio/ogg",
  }) as { seconds?: number };

  assert.equal(content.seconds, undefined);
});

test("áudio é reconhecido pela extensão quando o MIME não vem", () => {
  const content = buildOutboundMediaContent(URL_AUDIO) as {
    audio?: unknown;
    mimetype?: string;
  };

  assert.ok(content.audio);
  assert.equal(content.mimetype, "audio/ogg");
});

test("a query da URL assinada não confunde a detecção pela extensão", () => {
  const content = buildOutboundMediaContent(`${URL_AUDIO}?_a=BAMAB`) as { audio?: unknown };

  assert.ok(content.audio);
});

test("imagem e documento continuam como estavam", () => {
  const imagem = buildOutboundMediaContent(URL_IMAGEM, "olha aí", {
    mimeType: "image/jpeg",
  }) as { image?: { url: string }; caption?: string; ptt?: boolean };
  assert.equal(imagem.image?.url, URL_IMAGEM);
  assert.equal(imagem.caption, "olha aí");
  assert.equal(imagem.ptt, undefined);

  const documento = buildOutboundMediaContent(URL_PDF, "[documento]", {
    mimeType: "application/pdf",
    fileName: "nota.pdf",
  }) as { document?: { url: string }; fileName?: string; mimetype?: string };
  assert.equal(documento.document?.url, URL_PDF);
  assert.equal(documento.fileName, "nota.pdf");
  assert.equal(documento.mimetype, "application/pdf");
});

test("arquivo desconhecido vira documento, com nome tirado da URL", () => {
  const content = buildOutboundMediaContent(
    "https://exemplo.com/arquivos/planilha.xlsx",
  ) as { document?: unknown; fileName?: string; mimetype?: string };

  assert.ok(content.document);
  assert.equal(content.fileName, "planilha.xlsx");
  assert.match(String(content.mimetype), /spreadsheetml/);
});
