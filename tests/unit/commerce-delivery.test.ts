import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deliveryEstimate } from "../../lib/commerce";

const settings = {
  isActive: true,
  minMinutes: 30,
  maxMinutes: 50,
  defaultMinutes: null,
  additionalMarginMinutes: 10,
  timezone: "America/Sao_Paulo",
  dispatchMessage: null,
  schedule: [],
};

test("preserva a estimativa calculada a partir da configuração vigente", () => {
  const orderedAt = new Date("2026-07-29T12:00:00.000Z");
  assert.deepEqual(deliveryEstimate(settings, orderedAt), {
    orderedAt: "2026-07-29T12:00:00.000Z",
    minMinutes: 40,
    maxMinutes: 60,
    startAt: "2026-07-29T12:40:00.000Z",
    endAt: "2026-07-29T13:00:00.000Z",
  });
  assert.equal(deliveryEstimate({ ...settings, isActive: false }, orderedAt), null);
});

test("migração comercial aplica RLS e índices tenant-aware", async () => {
  const migration = await readFile("supabase/migrations/202607290011_commerce_operations.sql", "utf8");
  for (const table of ["promotions", "promotion_media", "business_locations", "delivery_settings", "orders", "order_status_history", "notification_outbox"]) {
    assert.match(migration, /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /UNIQUE \(organization_id, idempotency_key\)/);
  assert.match(migration, /expires_at > starts_at/);
});

test("serviço mantém o filtro de validade e a idempotência no tenant", async () => {
  const source = await readFile("lib/commerce.ts", "utf8");
  assert.match(source, /p\.organization_id=\$1 AND p\.status='active' AND p\.starts_at <= \$2 AND p\.expires_at > \$2/);
  assert.match(source, /withTenantTransaction\(organizationId/);
  assert.match(source, /order-dispatched:\$\{orderId\}/);
});
