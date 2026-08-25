import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { presenceSnapshot } from "@/lib/presence";
import { listTeamForPresence } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Quem da equipe está no painel agora.
 *
 * Duas fontes se encontram aqui. A lista de pessoas vem do banco — é ela que
 * decide quem existe e quem foi desativado. O estado vem da memória do processo,
 * alimentado pelas conexões do socket. Quem não aparece no snapshot está
 * offline, e o `lastSeenAt` do banco responde desde quando.
 *
 * Vale a permissão de "Visão da operação", que é onde o card aparece: sem isso,
 * um atendente sem acesso ao painel gerencial leria pela API o quadro de quem
 * está trabalhando, que é justamente o que aquela permissão controla.
 */
export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "dashboard", "read");
  if (denied) return denied;

  const now = Date.now();
  const live = presenceSnapshot(auth.session.organizationId, now);
  const team = await listTeamForPresence(auth.session.organizationId);

  const byUser = new Map(live.map((entry) => [entry.userId, entry]));
  const members = team.map((member) => {
    const entry = byUser.get(member.id);
    return {
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      state: entry?.state ?? ("offline" as const),
      connections: entry?.connections ?? 0,
      // Conectado, o instante confiável é o da memória; desconectado, é o que
      // ficou gravado na saída. Misturar os dois numa coluna só do banco daria
      // um "visto por último" que envelhece enquanto a pessoa está online.
      lastSeenAt: entry
        ? new Date(entry.lastActivityAt).toISOString()
        : member.lastSeenAt,
      openConversations: member.openConversations,
    };
  });

  const online = members.filter((member) => member.state === "online").length;
  const ausente = members.filter((member) => member.state === "ausente").length;

  return NextResponse.json({
    members,
    totals: {
      online,
      ausente,
      offline: members.length - online - ausente,
      equipe: members.length,
    },
    generatedAt: new Date(now).toISOString(),
  });
}
