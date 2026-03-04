"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@willtalk.local");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const payload = await response.json();
        setError(payload.error || "Falha no login");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Falha de rede ao autenticar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="login-card">
      <h1>WillTalk</h1>
      <p>Plataforma de suporte WhatsApp</p>

      <label htmlFor="email">E-mail</label>
      <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />

      <label htmlFor="password">Senha</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      {error ? <div className="error-box">{error}</div> : null}

      <button type="submit" disabled={loading}>
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}

