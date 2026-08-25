import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const RAIZ = "app/api/metrics/v1";
const SEM_SESSAO = new Set([
  path.join(RAIZ, "health", "route.ts"),
  path.join(RAIZ, "auth", "login", "route.ts"),
  path.join(RAIZ, "auth", "password", "forgot", "route.ts"),
  path.join(RAIZ, "auth", "password", "reset", "route.ts"),
]);

async function rotas(diretorio: string): Promise<string[]> {
  const entradas = await readdir(diretorio, { withFileTypes: true });
  const aninhadas = await Promise.all(
    entradas.map(async (entrada) => {
      const completo = path.join(diretorio, entrada.name);
      if (entrada.isDirectory()) return rotas(completo);
      return entrada.name === "route.ts" ? [completo] : [];
    }),
  );
  return aninhadas.flat();
}

test("nenhuma rota de metricas aceita organizacao vinda da requisicao", async () => {
  for (const rota of await rotas(RAIZ)) {
    const fonte = await readFile(rota, "utf8");
    assert.doesNotMatch(
      fonte,
      /searchParams\.get\(\s*["'](?:org|organization|organizationId|organization_id|empresa)["']/i,
      `${rota} aceita organização por parâmetro`,
    );
    assert.doesNotMatch(
      fonte,
      /headers\.get\(\s*["']x-(?:org|organization|organization-id|organization_id|empresa)["']/i,
      `${rota} aceita organização por cabeçalho`,
    );
  }
});

test("toda rota autenticada passa pelo guard e usa a organizacao da sessao", async () => {
  for (const rota of await rotas(RAIZ)) {
    if (SEM_SESSAO.has(rota)) continue;
    const fonte = await readFile(rota, "utf8");
    assert.match(fonte, /requireMetricsAccess/, `${rota} não usa o guard`);
    assert.match(
      fonte,
      /session\.organizationId/,
      `${rota} não deriva a organização da sessão`,
    );
  }
});

test("toda consulta de metrica filtra organization_id explicitamente", async () => {
  const arquivos = (await readdir("lib/metrics")).filter((nome) => nome.endsWith(".ts"));
  for (const nome of arquivos) {
    const fonte = await readFile(path.join("lib/metrics", nome), "utf8");
    if (!fonte.includes("queryTenantDatabase")) continue;
    assert.match(
      fonte,
      /organization_id = \$1/,
      `lib/metrics/${nome} consulta sem filtro explícito de organização`,
    );
  }
});
