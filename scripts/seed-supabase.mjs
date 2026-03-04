import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados no .env");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgId = process.env.DEFAULT_ORG_ID || "org_willtalk-40733";
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@willtalk.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";

  console.log("Seeding Supabase...");
  console.log("Organization:", orgId);
  console.log("Admin email:", adminEmail);

  // 1) Organização
  {
    const { error } = await supabase
      .from("organizations")
      .upsert({ id: orgId, name: "WillTalk" }, { onConflict: "id" });
    if (error) {
      console.error("Erro ao criar/atualizar organization:", error);
      process.exit(1);
    }
  }

  // 2) Usuário admin
  const { data: existingUser, error: existingErr } = await supabase
    .from("users")
    .select("id")
    .eq("organization_id", orgId)
    .ilike("email", adminEmail)
    .maybeSingle();

  if (existingErr) {
    console.error("Erro ao checar usuario admin existente:", existingErr);
    process.exit(1);
  }

  if (existingUser) {
    console.log("Usuario admin já existe no Supabase, nada a fazer.");
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const id = randomUUID();
    const { error } = await supabase.from("users").insert({
      id,
      organization_id: orgId,
      name: "Administrador",
      email: adminEmail.toLowerCase().trim(),
      password_hash: passwordHash,
      role: "admin",
      is_active: true,
    });
    if (error) {
      console.error("Erro ao criar usuario admin:", error);
      process.exit(1);
    }
    console.log("Usuario admin criado com sucesso no Supabase.");
  }

  console.log("Seed Supabase concluído.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

