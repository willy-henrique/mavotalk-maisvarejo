import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByEmail } from "@/lib/repo";
import { loginSchema } from "@/lib/schemas";
import { setSessionCookie, signSession } from "@/lib/auth";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";
import { requestIdFrom, structuredOperationLog } from "@/lib/observability";

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const startedAt = Date.now();
  const forwardedFor = request.headers.get("x-forwarded-for") || "unknown";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido", requestId }, { status: 400 });
  }
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", requestId }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const rateLimit = await consumeRateLimit(
    "login",
    rateLimitSubject(`${forwardedFor.split(",")[0]}:${email.toLowerCase()}`),
    10,
    60,
  );
  if (!rateLimit.allowed) {
    const status = rateLimit.unavailable ? 503 : 429;
    return NextResponse.json(
      {
        error: rateLimit.unavailable
          ? "Proteção de login temporariamente indisponível"
          : "Muitas tentativas. Tente novamente em instantes.",
        requestId,
      },
      {
        status,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const user = await getUserByEmail(email);
  if (!user || user.isActive === false) {
    structuredOperationLog(
      { requestId, durationMs: Date.now() - startedAt, status: "denied" },
      "Login rejected",
    );
    return NextResponse.json({ error: "Credenciais inválidas", requestId }, { status: 401 });
  }

  const validPassword = await bcrypt.compare(password, String(user.passwordHash || ""));
  if (!validPassword) {
    structuredOperationLog(
      {
        requestId,
        organizationId: user.organizationId,
        durationMs: Date.now() - startedAt,
        status: "denied",
      },
      "Login rejected",
    );
    return NextResponse.json({ error: "Credenciais inválidas", requestId }, { status: 401 });
  }

  const token = await signSession({
    userId: String(user.id),
    organizationId: String(user.organizationId),
    role: user.role as "admin" | "gestor" | "atendente",
    name: String(user.name || ""),
    email: String(user.email || ""),
  });

  await setSessionCookie(token);

  structuredOperationLog(
    {
      requestId,
      organizationId: user.organizationId,
      durationMs: Date.now() - startedAt,
      status: "success",
    },
    "Login succeeded",
  );
  return NextResponse.json({ ok: true, requestId });
}
