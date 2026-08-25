import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/lib/db";
import { metricsError } from "@/lib/metrics/envelope";
import { metricsServiceTokenIsValid } from "@/lib/metrics/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = request.headers.get("x-mavo-service-token");
  if (!metricsServiceTokenIsValid(token)) {
    return metricsError("unauthenticated", "Origem não autorizada");
  }

  const database = await checkDatabaseConnection();
  return NextResponse.json({ status: "ok", database });
}
