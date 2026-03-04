import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByEmail } from "@/lib/repo";
import { loginSchema } from "@/lib/schemas";
import { setSessionCookie, signSession } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos" }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const user = await getUserByEmail(email);
  if (!user || user.isActive === false) {
    return NextResponse.json({ error: "Credenciais invalidas" }, { status: 401 });
  }

  const validPassword = await bcrypt.compare(password, String(user.passwordHash || ""));
  if (!validPassword) {
    return NextResponse.json({ error: "Credenciais invalidas" }, { status: 401 });
  }

  const token = await signSession({
    userId: String(user.id),
    organizationId: String(user.organizationId),
    role: user.role as "admin" | "gestor" | "atendente",
    name: String(user.name || ""),
    email: String(user.email || ""),
  });

  await setSessionCookie(token);

  return NextResponse.json({ ok: true });
}
