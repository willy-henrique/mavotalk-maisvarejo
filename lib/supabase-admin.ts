import { createClient } from "@supabase/supabase-js";
import { createPostgresSupabaseShim, type SupabaseLikeClient } from "@/lib/postgres-supabase-shim";

type AnyDbClient = ReturnType<typeof createClient> | SupabaseLikeClient;

let client: AnyDbClient | null = null;

export function getSupabaseClient(): AnyDbClient {
  if (client) {
    return client;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl =
    process.env.DATABASE_URL_RUNTIME || process.env.DATABASE_URL;

  if (databaseUrl) {
    client = createPostgresSupabaseShim();
    return client;
  }

  if (!url || !serviceRoleKey) {
    throw new Error("Configure DATABASE_URL ou SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no .env");
  }

  client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return client;
}
