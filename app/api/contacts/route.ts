import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { listContacts } from "@/lib/repo";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const contacts = await listContacts(auth.session.organizationId);
  return NextResponse.json({ contacts });
}
