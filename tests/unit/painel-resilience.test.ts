import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("central de conexão trata falha de status sem manter a tela em carregamento", async () => {
  const source = await readFile("frontend/components/Painel.tsx", "utf8");

  assert.match(source, /await res\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(source, /setLoading\(false\)/);
  assert.match(source, /statusRequestRef/);
  assert.match(source, /request !== statusRequestRef\.current/);
  assert.match(source, /LoadingState/);
  assert.match(source, /ErrorState/);
  assert.match(source, /Atualizando…/);
});
