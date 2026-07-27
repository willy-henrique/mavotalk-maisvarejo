import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("sidebar usa a política de leitura por tenant, sem tratar visibilidade como autorização", async () => {
  const source = await readFile("frontend/components/Sidebar.tsx", "utf8");
  const roleCheck = source.indexOf("const roleAllowed");
  const policyCheck = source.indexOf("Boolean(visibilityOverrides[item.id]) && Boolean(permissions[item.id]?.read)");

  assert.ok(roleCheck >= 0, "Sidebar precisa manter fallback conservador durante o carregamento");
  assert.ok(policyCheck > roleCheck, "política do servidor deve ser aplicada após o fallback visual");
  assert.match(source, /if \(!visibilityOverrides \|\| !permissions\) return roleAllowed/);
  assert.match(source, /data\.permissions/);
});
