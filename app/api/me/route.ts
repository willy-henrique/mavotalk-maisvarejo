import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  return NextResponse.json({ user: auth.session });
}

