import { NextResponse } from "next/server";
import { getMavoMasterSession } from "@/lib/mavo-master-auth";

export async function requireMavoMaster() {
  const session = await getMavoMasterSession();
  if (!session) {
    return {
      error: NextResponse.json({ error: "Sessão master inválida ou expirada." }, { status: 401 }),
      session: null,
    };
  }
  return { error: null, session };
}
