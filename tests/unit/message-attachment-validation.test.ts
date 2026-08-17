import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MESSAGE_ATTACHMENT_BYTES,
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
