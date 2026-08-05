// Diagnóstico SOMENTE LEITURA do caminho "cliente digita 1 -> flyers".
// Nenhum INSERT/UPDATE/DELETE. Não imprime segredos.
import pg from "file:///C:/willydev/willtalk/node_modules/pg/lib/index.js";
import { readFileSync } from "node:fs";

// Prioriza DIAG_DATABASE_URL (produção). Sem ela, cai no .env local.
const env = {};
try {
  for (const line of readFileSync("C:/willydev/willtalk/.env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const connectionString = process.env.DIAG_DATABASE_URL || env.DATABASE_URL;
if (!connectionString) {
  console.error("Defina DIAG_DATABASE_URL com a connection string do Supabase.");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
console.log(`Banco: ${local ? "LOCAL" : "REMOTO (Supabase)"}`);

const client = new pg.Client({
  connectionString,
  ssl: local && String(env.PG_SSL || "").toLowerCase() === "false" ? false : { rejectUnauthorized: false },
});

const show = (title, rows) => {
  console.log(`\n=== ${title} ===`);
  if (!rows.length) return console.log("(vazio)");
  console.table(rows);
};

await client.connect();

const orgs = await client.query(
  `SELECT id, store_name, bot_enabled,
          (bot_offers_text  IS NOT NULL AND bot_offers_text  <> '') AS tem_offers_text,
          (bot_offers_url   IS NOT NULL AND bot_offers_url   <> '') AS tem_offers_url,
          (bot_offers_image_url IS NOT NULL AND bot_offers_image_url <> '') AS tem_offers_image
     FROM organizations ORDER BY id`,
);
show("organizations (config legada do bot)", orgs.rows);

const queues = await client.query(
  `SELECT organization_id, id, name, menu_option, is_active, queue_type
     FROM queues ORDER BY organization_id, menu_option`,
);
show("queues", queues.rows);

const configs = await client.query(
  `SELECT organization_id, queue_id, status, queue_type,
          (automation_config->>'enabled') AS automation_enabled,
          published_at IS NOT NULL AS publicado
     FROM queue_configurations ORDER BY organization_id, queue_id, status`,
);
show("queue_configurations", configs.rows);

const promos = await client.query(
  `SELECT p.organization_id, p.queue_id, p.title,
          p.published_at IS NOT NULL AS published_at_ok,
          p.published_active, p.published_archived,
          p.starts_at <= now() AS ja_comecou,
          p.expires_at > now()  AS ainda_valida,
          count(m.id)::int AS midias
     FROM promotions p
     LEFT JOIN promotion_media m ON m.promotion_id = p.id AND m.organization_id = p.organization_id
    GROUP BY p.id
    ORDER BY p.organization_id, p.display_order`,
);
show("promotions (cada coluna precisa ser true, midias >= 1)", promos.rows);

// Reproduz exatamente o filtro de getActivePromotions.
const ativas = await client.query(
  `SELECT p.organization_id, p.queue_id, count(*)::int AS promocoes_que_o_bot_enviaria
     FROM promotions p
    WHERE p.published_at IS NOT NULL AND p.published_active = true AND p.published_archived = false
      AND p.starts_at <= now() AND p.expires_at > now()
    GROUP BY p.organization_id, p.queue_id`,
);
show("VEREDITO — getActivePromotions", ativas.rows);

await client.end();
