import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL nao configurada no .env");
    process.exit(1);
  }

  const orgId = process.env.DEFAULT_ORG_ID || "org_willtalk_default";
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@willtalk.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";

  if (process.env.NODE_ENV === "production" && (!process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD)) {
    throw new Error("Configure SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD antes do seed de produção.");
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log("Seeding PostgreSQL...");
    console.log("Organization:", orgId);
    console.log("Admin email:", adminEmail);

    await pool.query(
      `
      INSERT INTO organizations (id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      `,
      [orgId, "Mavo Talk"],
    );

    const existing = await pool.query(
      `
      SELECT id
      FROM users
      WHERE organization_id = $1
        AND LOWER(email) = LOWER($2)
      LIMIT 1
      `,
      [orgId, adminEmail],
    );

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    if (existing.rowCount && existing.rowCount > 0) {
      await pool.query(
        `UPDATE users SET password_hash = $1, role = 'admin', is_active = true, updated_at = now()
         WHERE id = $2 AND organization_id = $3`,
        [passwordHash, existing.rows[0].id, orgId],
      );
      console.log("Usuario admin atualizado com sucesso.");
    } else {
      await pool.query(
        `
        INSERT INTO users (
          id, organization_id, name, email, password_hash, role, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [randomUUID(), orgId, "Administrador", adminEmail.toLowerCase().trim(), passwordHash, "admin", true],
      );
      console.log("Usuario admin criado com sucesso.");
    }

    const queues = [
      [1, "Ofertas e promoções", "#F97316", 5],
      [2, "Horários e localização", "#3B82F6", 5],
      [3, "Entregas e pedidos", "#8B5CF6", 10],
      [4, "Produtos e disponibilidade", "#14B8A6", 15],
      [5, "Açougue, padaria e hortifruti", "#22C55E", 15],
      [6, "Trocas, devoluções e pagamentos", "#EAB308", 20],
      [7, "Falar com um atendente", "#EF4444", 10],
    ];
    for (const [menuOption, name, colorHex, sla] of queues) {
      await pool.query(
        `INSERT INTO queues (id, organization_id, name, menu_option, color_hex, default_sla_mins, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (organization_id, menu_option) DO UPDATE SET
           name = EXCLUDED.name,
           color_hex = EXCLUDED.color_hex,
           default_sla_mins = EXCLUDED.default_sla_mins,
           is_active = true,
           updated_at = now()`,
        [randomUUID(), orgId, name, menuOption, colorHex, sla],
      );
    }
    await pool.query(
      "UPDATE queues SET is_active = false, updated_at = now() WHERE organization_id = $1 AND menu_option <> ALL($2::int[])",
      [orgId, queues.map(([menuOption]) => menuOption)],
    );
    console.log("Menu de supermercado configurado com sucesso.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
