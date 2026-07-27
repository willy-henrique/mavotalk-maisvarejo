import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { listContacts } from "@/lib/repo";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "contacts", "read");
  if (denied) return denied;

  const contacts = await listContacts(auth.session.organizationId);
  return NextResponse.json({ contacts });
}
