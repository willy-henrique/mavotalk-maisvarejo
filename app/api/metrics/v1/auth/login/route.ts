import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { signSession } from "@/lib/auth";
import { metricsError } from "@/lib/metrics/envelope";
import { metricsServiceTokenIsValid } from "@/lib/metrics/guard";
import { organizationForMetrics } from "@/lib/metrics/organization";
import { getOrganizationTimeZone } from "@/lib/organization-timezone";
import { getUserByEmail, recordUserLogin } from "@/lib/repo";
import { loginSchema } from "@/lib/schemas";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const ORIGEM_NAO_AUTORIZADA = "Origem não autorizada";
const DUMMY_PASSWORD_HASH = "$2b$10$43gEBlx3IdGurlE9rPXEhOM6awkiW284rZc.VfxXpt8drG0O/ki4G";

function credencialInvalida() {
  return metricsError("unauthenticated", "E-mail ou senha inválidos");
}

export async function POST(request: Request) {
  if (!metricsServiceTokenIsValid(request.headers.get("x-mavo-service-token"))) {
    return metricsError("unauthenticated", ORIGEM_NAO_AUTORIZADA);
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return credencialInvalida();
  }

  const analisado = loginSchema.safeParse(corpo);
  if (!analisado.success) return credencialInvalida();

  const { email, password } = analisado.data;
  const origem = (request.headers.get("x-forwarded-for") || "desconhecido").split(",")[0];

  try {
    const limite = await consumeRateLimit(
      "metrics-login",
      rateLimitSubject(`${origem}:${email.toLowerCase()}`),
      10,
      60,
    );
    if (!limite.allowed) {
      return metricsError("rate_limited", "Muitas tentativas. Tente novamente em instantes.");
    }

    const usuario = await getUserByEmail(email);
    const senhaConfere = await bcrypt.compare(
      password,
      String(usuario?.passwordHash || DUMMY_PASSWORD_HASH),
    );
    if (!usuario || usuario.isActive === false || !senhaConfere) return credencialInvalida();

    if (usuario.role === "atendente") {
      return metricsError("forbidden", "Este painel é para gestão");
    }

    const [organization, timezone] = await Promise.all([
      organizationForMetrics(usuario.organizationId, usuario.id),
      getOrganizationTimeZone(usuario.organizationId),
    ]);
    const token = await signSession({
      userId: usuario.id,
      organizationId: usuario.organizationId,
      role: usuario.role,
      name: usuario.name,
      email: usuario.email,
    });
    await recordUserLogin(usuario.organizationId, usuario.id);

    return NextResponse.json({
      data: {
        token,
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        user: {
          id: usuario.id,
          name: usuario.name,
          email: usuario.email,
          role: usuario.role,
        },
        organization: { ...organization, timezone },
      },
    });
  } catch {
    return metricsError("internal", "Não foi possível entrar agora");
  }
}
