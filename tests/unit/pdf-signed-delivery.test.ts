import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cloudinaryResourceTypeFromUrl } from "../../lib/cloudinary";

const read = (relative: string) =>
  readFile(path.resolve(relative), "utf8");

/**
 * O PDF chegava por `fetch` direto na URL pública do Cloudinary, enquanto a imagem
 * — que sempre abriu — passa por URL assinada. A conta recusa a entrega não assinada
 * do documento e o atendente só via "Não foi possível carregar o PDF armazenado."
 */
test("descobre o resource_type do Cloudinary pela URL guardada", () => {
  assert.equal(
    cloudinaryResourceTypeFromUrl(
      "https://res.cloudinary.com/dgi1nxtb0/raw/upload/v1755000000/willtalk/messages/abc.pdf",
    ),
    "raw",
  );
  assert.equal(
    cloudinaryResourceTypeFromUrl(
      "https://res.cloudinary.com/dgi1nxtb0/image/upload/v1755000000/willtalk/messages/abc.pdf",
    ),
    "image",
  );
  assert.equal(
    cloudinaryResourceTypeFromUrl(
      "https://res.cloudinary.com/dgi1nxtb0/video/upload/v1/willtalk/messages/audio.ogg",
    ),
    "video",
  );
  assert.equal(cloudinaryResourceTypeFromUrl("https://exemplo.com/arquivo.pdf"), null);
  assert.equal(cloudinaryResourceTypeFromUrl("nao-e-url"), null);
});

test("o visualizador de PDF busca o arquivo pela URL assinada, como já faz a imagem", async () => {
  const [route, cloudinaryLib] = await Promise.all([
    read("app/api/media/pdf/route.ts"),
    read("lib/cloudinary.ts"),
  ]);

  // A assinatura vem do public_id guardado na mensagem, o mesmo caminho de /api/media/signed.
  assert.match(route, /cloudinaryPublicId/);
  assert.match(route, /signedDeliveryUrl/);
  assert.match(cloudinaryLib, /export function signedDeliveryUrl/);
  assert.match(cloudinaryLib, /sign_url: true/);

  // Sem public_id (mensagens antigas) ainda tenta a URL guardada, para não perder histórico.
  assert.match(route, /media\.mediaUrl/);

  // A falha precisa dizer o que o Cloudinary respondeu: sem isso o diagnóstico exige deploy.
  assert.match(route, /upstreamStatus|status: upstream\.status/);
  assert.match(route, /x-cld-error/);
});
