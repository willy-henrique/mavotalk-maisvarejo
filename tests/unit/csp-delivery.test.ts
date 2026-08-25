import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("frame-ancestors é entregue por header, não por meta CSP", async () => {
  const [indexHtml, nextConfig, renderConfig] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("next.config.ts", "utf8"),
    readFile("render.yaml", "utf8"),
  ]);

  assert.doesNotMatch(indexHtml, /frame-ancestors/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(renderConfig, /frame-ancestors 'none'/);
});

test("o painel pode usar o microfone e instanciar o encoder de áudio", async () => {
  const renderConfig = await readFile("render.yaml", "utf8");

  // `microphone=()` é lista vazia: proíbe até a própria origem, e o pedido de
  // acesso falha antes de o navegador perguntar qualquer coisa ao atendente.
  assert.match(renderConfig, /microphone=\(self\)/);
  assert.doesNotMatch(renderConfig, /microphone=\(\)/);

  // O encoder de voz é WebAssembly. Sob CSP nível 3, instanciar WASM exige
  // 'wasm-unsafe-eval' — que não libera eval() de JavaScript.
  assert.match(renderConfig, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(renderConfig, /script-src 'self' 'unsafe-eval'/);

  // O worker é servido pela mesma origem da página: o encoder não funciona
  // cross-origin, e abrir para blob: alargaria a superfície sem necessidade.
  assert.match(renderConfig, /worker-src 'self'/);

  // A prévia antes de enviar toca de um blob: local.
  assert.match(renderConfig, /media-src 'self' blob:/);
});

test("o CSP do header e o da meta tag concordam sobre WASM", async () => {
  // Header e meta são aplicados os dois, e vale o mais restritivo de cada
  // diretiva. Corrigir só um lado deixaria o encoder bloqueado do mesmo jeito,
  // com o erro aparecendo apenas no console do atendente.
  const indexHtml = await readFile("frontend/index.html", "utf8");

  assert.match(indexHtml, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(indexHtml, /worker-src 'self'/);
  assert.match(indexHtml, /media-src 'self' blob:/);
});

test("câmera, geolocalização e pagamento continuam bloqueados", async () => {
  const renderConfig = await readFile("render.yaml", "utf8");

  assert.match(renderConfig, /camera=\(\)/);
  assert.match(renderConfig, /geolocation=\(\)/);
  assert.match(renderConfig, /payment=\(\)/);
});
