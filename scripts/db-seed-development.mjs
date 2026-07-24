import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { createMigrationPool } from "./db-common.mjs";

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed de desenvolvimento é proibido em produção");
}

const organizationId =
  process.env.DEV_SEED_ORGANIZATION_ID || "org_mavo_talk_development";
const managerPhone = process.env.DEV_SEED_MANAGER_PHONE || "5511999999999";
const managerPin = process.env.DEV_SEED_MANAGER_PIN || "123456";

if (!/^\d{6,}$/.test(managerPin)) {
  throw new Error("DEV_SEED_MANAGER_PIN deve conter ao menos 6 dígitos");
}

const pool = createMigrationPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO organizations (id, name)
     VALUES ($1, 'Mavo Talk Desenvolvimento')
     ON CONFLICT (id) DO NOTHING`,
    [organizationId],
  );
  await client.query(
    `INSERT INTO business_access_users (
       id, organization_id, name, phone_normalized, role, pin_hash, pin_changed_at
     )
     VALUES ($1, $2, 'Gestor de Desenvolvimento', $3, 'owner', $4, now())
     ON CONFLICT (organization_id, phone_normalized)
     DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
                   pin_hash = EXCLUDED.pin_hash, pin_changed_at = now(),
                   is_active = true, updated_at = now()`,
    [randomUUID(), organizationId, managerPhone, await bcrypt.hash(managerPin, 12)],
  );

  for (let offset = 0; offset < 30; offset += 1) {
    const saleDate = new Date();
    saleDate.setUTCDate(saleDate.getUTCDate() - offset);
    const date = saleDate.toISOString().slice(0, 10);
    const net = 8_000 + offset * 113.37;
    const count = 55 + (offset % 12);
    await client.query(
      `INSERT INTO business_sales_daily (
         organization_id, sale_date, gross_total, net_total, discount_total,
         cancelled_total, sales_count, items_quantity, average_ticket,
         source_updated_at
       )
       VALUES ($1, $2, $3, $4, 120, 0, $5, $6, $7, now())
       ON CONFLICT (organization_id, sale_date)
       DO UPDATE SET gross_total = EXCLUDED.gross_total,
                     net_total = EXCLUDED.net_total,
                     sales_count = EXCLUDED.sales_count,
                     items_quantity = EXCLUDED.items_quantity,
                     average_ticket = EXCLUDED.average_ticket,
                     source_updated_at = EXCLUDED.source_updated_at,
                     updated_at = now()`,
      [organizationId, date, net + 120, net, count, count * 5, net / count],
    );
  }

  await client.query("COMMIT");
  console.log(
    `Seed aplicado somente em desenvolvimento para ${organizationId}. PIN não foi exibido.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
