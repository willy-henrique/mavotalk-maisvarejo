import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { applySupermarketQueuePreset } from "@/lib/supermarket-setup";

export async function POST() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "admin_types", "create");
  if (denied) return denied;

  const result = await applySupermarketQueuePreset(
    auth.session.organizationId,
    auth.session.userId,
  );

  return NextResponse.json(result);
}
