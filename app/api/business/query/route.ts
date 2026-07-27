import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { routeBusinessQuery } from "@/lib/business-analytics/business-query-router";
import { analyticsContextFromSession } from "@/lib/business-analytics/business-api-context";
import { requireFeature } from "@/lib/config/mavo-config";
import { sanitizedError } from "@/lib/observability";

const schema = z.object({ query: z.string().trim().min(1).max(500) }).strict();

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "business", "read");
  if (denied) return denied;
  try {
    requireFeature("businessAnalyticsEnabled");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Consulta inválida" }, { status: 400 });
    }
    return NextResponse.json(
      await routeBusinessQuery(
        analyticsContextFromSession(auth.session),
        parsed.data.query,
        { userName: auth.session.name },
      ),
    );
  } catch (error) {
    return NextResponse.json(
      { error: sanitizedError(error) },
      { status: Number((error as { status?: number }).status || 500) },
    );
  }
}
