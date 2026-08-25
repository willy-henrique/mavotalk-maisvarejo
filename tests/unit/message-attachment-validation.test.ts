import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MESSAGE_ATTACHMENT_BYTES,
  cloudinaryResourceTypeForAttachment,
  sanitizeAttachmentFileName,
  validateMessageAttachment,
} from "../../lib/message-attachment-validation";

const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n"));

test("aceita PDF real, corrige MIME genérico e preserva nome seguro", () => {
  const result = validateMessageAttachment(
    {
      name: "../Proposta cliente.pdf",
      size: pdf.byteLength,
      type: "application/octet-stream",
    } as File,
    pdf,
  );
  assert.deepEqual(result, {
    kind: "document",
    mimeType: "application/pdf",
    fileName: "..-Proposta cliente.pdf",
    placeholder: "[documento]",
  });
});

test("recusa arquivo renomeado para PDF e anexo acima do limite", () => {
  assert.throws(
    () =>
      validateMessageAttachment(
        { name: "arquivo.pdf", size: 8, type: "application/pdf" } as File,
        new Uint8Array(Buffer.from("nao-pdf")),
      ),
    /não é um PDF válido/,
  );
  assert.throws(
    () =>
      validateMessageAttachment(
        {
          name: "grande.pdf",
          size: MAX_MESSAGE_ATTACHMENT_BYTES + 1,
          type: "application/pdf",
        } as File,
        pdf,
      ),
    /no máximo 16 MB/,
  );
});

test("remove separadores e caracteres de controle do nome enviado ao WhatsApp", () => {
  assert.equal(
    sanitizeAttachmentFileName("pasta\\subpasta/arquivo\0.pdf", "documento.pdf"),
    "pasta-subpasta-arquivo-.pdf",
  );
});

// ---------------------------------------------------------------------------
// Áudio gravado pelo atendente
// ---------------------------------------------------------------------------

/** Container Ogg: os quatro primeiros bytes são sempre "OggS". */
function ogg(extra = 64): Uint8Array {
  const bytes = new Uint8Array(4 + extra);
  bytes.set([0x4f, 0x67, 0x67, 0x53]);
  return bytes;
}

test("aceita a gravação em ogg/opus que o navegador produz", () => {
  const result = validateMessageAttachment(
    { name: "gravacao.ogg", size: ogg().byteLength, type: "audio/ogg" } as File,
    ogg(),
  );

  assert.deepEqual(result, {
    kind: "audio",
    mimeType: "audio/ogg",
    fileName: "gravacao.ogg",
    placeholder: "[audio]",
  });
});

test("aceita o MIME com o codec declarado junto", () => {
  // MediaRecorder e opus-recorder entregam "audio/ogg; codecs=opus".
  const result = validateMessageAttachment(
    { name: "nota.ogg", size: ogg().byteLength, type: "audio/ogg; codecs=opus" } as File,
    ogg(),
  );

  assert.equal(result.kind, "audio");
  assert.equal(result.mimeType, "audio/ogg");
});

test("garante a extensão .ogg mesmo quando o nome vem sem ela", () => {
  const result = validateMessageAttachment(
    { name: "gravacao", size: ogg().byteLength, type: "audio/ogg" } as File,
    ogg(),
  );

  assert.equal(result.fileName, "gravacao.ogg");
});

test("recusa arquivo que se diz áudio mas não é um container Ogg", () => {
  // Confiar no type declarado seria aceitar a palavra do navegador sobre o
  // conteúdo — e o WhatsApp entregaria uma nota de voz que não toca.
  assert.throws(
    () =>
      validateMessageAttachment(
        { name: "falso.ogg", size: 16, type: "audio/ogg" } as File,
        new Uint8Array(Buffer.from("nao-e-ogg-nenhum")),
      ),
    /não é um áudio válido/,
  );
});

test("recusa formato de áudio que o WhatsApp não toca como nota de voz", () => {
  assert.throws(
    () =>
      validateMessageAttachment(
        { name: "gravacao.webm", size: 64, type: "audio/webm" } as File,
        new Uint8Array(64),
      ),
    /Envie uma imagem/,
  );
});

test("áudio respeita o mesmo teto de tamanho dos outros anexos", () => {
  assert.throws(
    () =>
      validateMessageAttachment(
        {
          name: "longo.ogg",
          size: MAX_MESSAGE_ATTACHMENT_BYTES + 1,
          type: "audio/ogg",
        } as File,
        ogg(),
      ),
    /16 MB/,
  );
});

// ---------------------------------------------------------------------------
// Tipo de recurso no Cloudinary
// ---------------------------------------------------------------------------

test("cada anexo é removido do Cloudinary com o tipo com que foi guardado", () => {
  // Áudio sobe como `video` no Cloudinary. Limpar como `image` não apagaria
  // nada: o recurso ficaria órfão, e em silêncio.
  assert.equal(cloudinaryResourceTypeForAttachment("image"), "image");
  assert.equal(cloudinaryResourceTypeForAttachment("document"), "raw");
  assert.equal(cloudinaryResourceTypeForAttachment("audio"), "video");
});
