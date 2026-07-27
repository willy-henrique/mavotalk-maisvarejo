import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { getMenuVisibilityForRole } from "@/lib/menu-settings";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const visibility = await getMenuVisibilityForRole(auth.session.organizationId, auth.session.role);
  return NextResponse.json({ visibility });
}
