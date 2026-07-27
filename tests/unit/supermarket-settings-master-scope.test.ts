import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("leitura da configuração do supermercado respeita a organização escolhida no painel master", async () => {
  const route = await readFile("app/api/admin/supermarket-settings/route.ts", "utf8");

  assert.match(route, /export async function GET\(request: Request\)/);
  assert.match(route, /requireSupermarketAdmin\(request\)/);
  assert.match(route, /getSupermarketSettings\(auth\.session\.organizationId\)/);
});
