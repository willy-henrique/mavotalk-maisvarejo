import test from "node:test";
import assert from "node:assert/strict";

// A configuração do Cloudinary é lida uma única vez, na carga do módulo. Por isso
// este arquivo não importa lib/cloudinary no topo: o ambiente precisa existir antes.
process.env.CLOUDINARY_CLOUD_NAME = "dgi1nxtb0";
process.env.CLOUDINARY_API_KEY = "481615268712763";
process.env.CLOUDINARY_API_SECRET = "segredo-de-teste";

test("a URL assinada sai no formato que o Cloudinary valida", async () => {
  const { signedDeliveryUrl } = await import("../../lib/cloudinary");

  // PDF recebido pelo WhatsApp: sobe como `raw`, com a extensão no public_id.
  const raw = signedDeliveryUrl("willtalk/messages/abc.pdf", "raw");
  assert.match(
    raw,
    /^https:\/\/res\.cloudinary\.com\/dgi1nxtb0\/raw\/upload\/s--[^/]+--\//,
  );
  // O SDK acrescenta `?_a=` (analytics) — o mesmo sufixo do caminho de imagem que
  // já funciona em produção, porque a assinatura cobre o caminho, não a query.
  assert.match(raw, /willtalk\/messages\/abc\.pdf(\?|$)/);

  // PDF antigo, vindo do Twilio: entrou como `image` e sem extensão no public_id.
  const image = signedDeliveryUrl("willtalk/messages/antigo", "image");
  assert.match(image, /\/image\/upload\/s--[^/]+--\//);
  assert.match(image, /antigo\.pdf(\?|$)/);

  // Sem public_id não há o que assinar: quem chama cai na URL guardada.
  assert.equal(signedDeliveryUrl("", "raw"), "");
});
