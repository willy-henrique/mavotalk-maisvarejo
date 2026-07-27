import test from "node:test";
import assert from "node:assert/strict";
import { requireTenantOrganizationId } from "@/lib/db";

test("contexto estrito de tenant aceita IDs técnicos e recusa SQL acidental", () => {
  assert.equal(requireTenantOrganizationId("org_willtalk_default"), "org_willtalk_default");
  assert.equal(requireTenantOrganizationId("1a2b3c4d-1111-2222-3333-123456789abc"), "1a2b3c4d-1111-2222-3333-123456789abc");
  assert.throws(() => requireTenantOrganizationId("SELECT * FROM users"), /organização inválido/);
  assert.throws(() => requireTenantOrganizationId("org id with spaces"), /organização inválido/);
});
