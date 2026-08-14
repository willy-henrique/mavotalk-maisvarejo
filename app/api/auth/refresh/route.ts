import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { setSessionCookie, signSession } from "@/lib/auth";

/**
 * Renova a sessão de quem está com o painel aberto.
 *
 * O token vale 12 horas e não havia renovação: a operação passa o dia com o painel
 * aberto e descobria a expiração ao tentar enviar uma mensagem, recebendo apenas
 * "Não autenticado". Renovar enquanto a sessão ainda é válida evita a queda no meio
 * do atendimento.
 */
export async function POST() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const token = await signSession({
    userId: auth.session.userId,
    organizationId: auth.session.organizationId,
    role: auth.session.role,
    name: auth.session.name,
    email: auth.session.email,
  });

  await setSessionCookie(token);

  // O token também volta no corpo: no celular o cookie é descartado por ser
  // third-party, e é o cabeçalho Authorization que sustenta a sessão.
  return NextResponse.json({ ok: true, token });
}
