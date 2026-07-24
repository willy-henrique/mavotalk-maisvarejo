import { NextResponse } from "next/server";
import {
  cerebroAutoReplySchema,
  hasValidAutoReplyToken,
  isAutoReplyEnabled,
  isAutoReplyRouteAllowed,
  processCerebroAutoReply,
} from "@/lib/cerebro-auto-reply";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  if (!isAutoReplyEnabled()) {
    return NextResponse.json({ error: "auto_reply_disabled" }, { status: 503 });
  }

  if (!isAutoReplyRouteAllowed(request.url)) {
    return NextResponse.json({ error: "route_not_allowed" }, { status: 404 });
  }

  if (!hasValidAutoReplyToken(request.headers.get("authorization"))) {
    logger.warn({ status: "error", error: "unauthorized" }, "Cerebro auto-reply unauthorized request");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.warn({ status: "error", error: "invalid_json" }, "Cerebro auto-reply invalid json");
    return NextResponse.json({ error: "payload_invalido" }, { status: 400 });
  }

  const parsed = cerebroAutoReplySchema.safeParse(body);
  if (!parsed.success) {
    logger.warn(
      {
        status: "error",
        error: "payload_invalido",
        details: parsed.error.flatten(),
      },
      "Cerebro auto-reply payload validation failed",
    );
    return NextResponse.json({ error: "payload_invalido" }, { status: 400 });
  }

  const result = await processCerebroAutoReply(parsed.data);
  return NextResponse.json(result.body, { status: result.statusCode });
}
