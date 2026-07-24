import { normalizeBusinessInput } from "@/lib/business-analytics/business-query-intents";
import { routeBusinessQuery } from "@/lib/business-analytics/business-query-router";
import {
  businessMenu,
  pinChallengeMessage,
} from "@/lib/business-analytics/business-response-formatter";
import {
  endBusinessSupportMode,
  recordBusinessAccessAudit,
  reserveBusinessWhatsappEvent,
  startBusinessSupportMode,
} from "@/lib/business-access/business-access-repository";
import { identifyBusinessPhone } from "@/lib/business-access/business-identity-service";
import { verifyBusinessPin } from "@/lib/business-access/business-pin-service";
import {
  establishBusinessSession,
  renewAuthorizedBusinessSession,
  revokeBusinessAccessSession,
} from "@/lib/business-access/business-session-service";

const supportCommands = new Set([
  "suporte",
  "falar com atendente",
  "falar com um atendente",
  "abrir chamado",
]);
const logoutCommands = new Set([
  "sair",
  "encerrar sessao",
  "bloquear acesso",
]);
const returnCommands = new Set([
  "menu gerencial",
  "voltar ao gerencial",
  "modo gerencial",
]);

export type BusinessWhatsappRoutingResult =
  | { destination: "support"; authorizedManager: boolean }
  | {
      destination: "business";
      reply: string;
      reason:
        | "challenge"
        | "authenticated"
        | "query"
        | "logout"
        | "locked"
        | "invalid_pin"
        | "unsupported_mfa"
        | "return_from_support"
        | "duplicate";
    };

export async function routeBusinessWhatsappMessage(input: {
  organizationId: string;
  phone: string;
  message: string;
  conversationReference?: string;
  requestId?: string;
}): Promise<BusinessWhatsappRoutingResult> {
  const identity = await identifyBusinessPhone(
    input.organizationId,
    input.phone,
    input.requestId,
  );
  const command = normalizeBusinessInput(input.message);

  if (
    identity.kind === "support" &&
    identity.businessSession &&
    logoutCommands.has(command)
  ) {
    await revokeBusinessAccessSession(identity.businessSession, "user_logout");
    await recordBusinessAccessAudit({
      organizationId: input.organizationId,
      accessUserId: identity.businessSession.accessUserId,
      phoneNormalized: identity.phoneNormalized,
      eventType: "session_revoked",
      requestId: input.requestId,
      metadata: { reason: "user_logout" },
    });
    return {
      destination: "business",
      reply: "Sessão gerencial encerrada com segurança.",
      reason: "logout",
    };
  }

  if (
    identity.kind === "support" &&
    identity.businessSession &&
    returnCommands.has(command)
  ) {
    await endBusinessSupportMode(
      input.organizationId,
      identity.phoneNormalized,
    );
    await recordBusinessAccessAudit({
      organizationId: input.organizationId,
      accessUserId: identity.businessSession.accessUserId,
      phoneNormalized: identity.phoneNormalized,
      eventType: "support_mode_ended",
      requestId: input.requestId,
    });
    if (!identity.businessSessionAuthenticated) {
      return {
        destination: "business",
        reply: pinChallengeMessage(),
        reason: "challenge",
      };
    }
    await renewAuthorizedBusinessSession(identity.businessSession);
    return {
      destination: "business",
      reply: businessMenu(identity.authorizedUser?.name),
      reason: "return_from_support",
    };
  }

  if (identity.kind === "support") {
    return {
      destination: "support",
      authorizedManager: Boolean(identity.authorizedUser),
    };
  }

  const reserved = await reserveBusinessWhatsappEvent({
    organizationId: input.organizationId,
    accessUserId: identity.user.id,
    phoneNormalized: identity.phoneNormalized,
    eventId: input.conversationReference,
  });
  if (!reserved) {
    return {
      destination: "business",
      reply: "",
      reason: "duplicate",
    };
  }

  if (identity.kind === "challenge") {
    if (!/^\d{6,12}$/.test(command)) {
      return {
        destination: "business",
        reply: pinChallengeMessage(),
        reason: "challenge",
      };
    }
    const verification = await verifyBusinessPin(
      identity.user,
      command,
      input.requestId,
    );
    if (!verification.ok) {
      if (verification.code === "LOCKED") {
        return {
          destination: "business",
          reply:
            "A autenticação foi temporariamente bloqueada após tentativas inválidas. Tente novamente mais tarde ou solicite o desbloqueio a um administrador.",
          reason: "locked",
        };
      }
      if (
        verification.code === "UNSUPPORTED" ||
        verification.code === "NOT_CONFIGURED"
      ) {
        return {
          destination: "business",
          reply:
            "Este acesso exige um método de autenticação ainda não disponível neste canal. Procure um administrador.",
          reason: "unsupported_mfa",
        };
      }
      if (
        verification.code === "RATE_LIMITED" ||
        verification.code === "RATE_LIMIT_UNAVAILABLE"
      ) {
        return {
          destination: "business",
          reply:
            "A validação está temporariamente indisponível ou recebeu tentativas em excesso. Aguarde um instante e tente novamente.",
          reason: "locked",
        };
      }
      return {
        destination: "business",
        reply: "Não foi possível autenticar. Verifique o PIN e tente novamente.",
        reason: "invalid_pin",
      };
    }
    const context = await establishBusinessSession(identity.user, "whatsapp");
    return {
      destination: "business",
      reply: businessMenu(context.name),
      reason: "authenticated",
    };
  }

  if (logoutCommands.has(command)) {
    await revokeBusinessAccessSession(identity.context, "user_logout");
    await recordBusinessAccessAudit({
      organizationId: input.organizationId,
      accessUserId: identity.user.id,
      phoneNormalized: identity.phoneNormalized,
      eventType: "session_revoked",
      requestId: input.requestId,
      metadata: { reason: "user_logout" },
    });
    return {
      destination: "business",
      reply: "Sessão gerencial encerrada com segurança.",
      reason: "logout",
    };
  }

  if (supportCommands.has(command)) {
    await startBusinessSupportMode(
      input.organizationId,
      identity.context.sessionId,
    );
    await recordBusinessAccessAudit({
      organizationId: input.organizationId,
      accessUserId: identity.user.id,
      phoneNormalized: identity.phoneNormalized,
      eventType: "support_mode_started",
      requestId: input.requestId,
    });
    return { destination: "support", authorizedManager: true };
  }

  let query: Awaited<ReturnType<typeof routeBusinessQuery>>;
  try {
    query = await routeBusinessQuery(
      {
        organizationId: identity.context.organizationId,
        accessUserId: identity.context.accessUserId,
        phoneNormalized: identity.context.phoneNormalized,
        conversationReference: input.conversationReference,
        origin: "whatsapp",
        permissions: identity.context.permissions,
      },
      input.message,
      { userName: identity.user.name },
    );
  } catch (error) {
    if ((error as { code?: string }).code === "BUSINESS_PERMISSION_DENIED") {
      return {
        destination: "business",
        reply:
          "Seu perfil não permite esta consulta. Escolha outra opção do menu ou solicite a permissão a um administrador.",
        reason: "query",
      };
    }
    throw error;
  }
  if (query.authorizedActivity) {
    await renewAuthorizedBusinessSession(identity.context);
  }
  return {
    destination: "business",
    reply: query.reply,
    reason: "query",
  };
}
