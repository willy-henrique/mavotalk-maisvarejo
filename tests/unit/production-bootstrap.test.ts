import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("deploy garante a organização padrão sem alterar credenciais de usuários", async () => {
  const [packageJson, blueprint, bootstrap, verifier] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("render.yaml", "utf8"),
    readFile("scripts/db-bootstrap-production.mjs", "utf8"),
    readFile("scripts/db-verify.mjs", "utf8"),
  ]);

  assert.match(packageJson, /"db:bootstrap:production"/);
  assert.match(
    blueprint,
    /db:migrate && npm run db:bootstrap:production && npm run db:verify/,
  );
  assert.match(bootstrap, /INSERT INTO organizations/);
  assert.match(bootstrap, /ON CONFLICT \(id\) DO NOTHING/);
  assert.doesNotMatch(bootstrap, /password|INSERT INTO users|UPDATE users/i);
  assert.match(verifier, /defaultOrganizationExists/);
});
