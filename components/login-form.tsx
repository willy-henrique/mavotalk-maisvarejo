"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, MavoBrand } from "@/components/mavo-brand";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error || "Não foi possível entrar. Confira seus dados e tente novamente.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Sem conexão com o servidor. Verifique sua internet e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-layout">
      <section className="login-story" aria-label="Apresentação Mavo Talk">
        <div className="login-story-glow glow-one" />
        <div className="login-story-glow glow-two" />
        <MavoBrand inverse />

        <div className="login-story-content">
          <span className="eyebrow light">
            <Icon name="sparkle" size={16} />
            Atendimento que aproxima
          </span>
          <h1>
            Conversas melhores.
            <br />
            <span>Relações mais fortes.</span>
          </h1>
          <p>
            Centralize seu atendimento no WhatsApp, organize demandas e dê ao seu time o contexto certo
            para resolver cada conversa com agilidade.
          </p>

          <div className="login-benefits">
            <div>
              <span className="benefit-icon"><Icon name="inbox" /></span>
              <span><strong>Inbox unificado</strong><small>Todas as conversas no mesmo lugar</small></span>
            </div>
            <div>
              <span className="benefit-icon"><Icon name="activity" /></span>
              <span><strong>Operação em tempo real</strong><small>Visibilidade para agir mais rápido</small></span>
            </div>
          </div>
        </div>

        <p className="login-story-footer">Mavo Talk <span>•</span> Comunicação inteligente, atendimento humano.</p>
      </section>

      <section className="login-access">
        <div className="login-mobile-brand"><MavoBrand /></div>
        <form onSubmit={onSubmit} className="login-card">
          <div className="login-heading">
            <span className="eyebrow">Bem-vindo de volta</span>
            <h2>Acesse sua central</h2>
            <p>Entre com suas credenciais para continuar o atendimento.</p>
          </div>

          <div className="field-group">
            <label htmlFor="email">E-mail</label>
            <div className="input-shell">
              <Icon name="user" size={18} />
              <input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="seuemail@empresa.com"
                autoComplete="email"
                autoFocus
                required
              />
            </div>
          </div>

          <div className="field-group">
            <div className="field-label-row">
              <label htmlFor="password">Senha</label>
              <span>Ambiente seguro</span>
            </div>
            <div className="input-shell">
              <Icon name="power" size={18} />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite sua senha"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
              </button>
            </div>
          </div>

          {error ? (
            <div className="error-box" role="alert" aria-live="polite">
              <span><Icon name="close" size={16} /></span>
              {error}
            </div>
          ) : null}

          <button className="primary-button login-submit" type="submit" disabled={loading}>
            {loading ? <span className="button-spinner" /> : <Icon name="arrow-left" className="login-arrow" />}
            {loading ? "Entrando..." : "Entrar no Mavo Talk"}
          </button>

          <p className="privacy-note">Ao entrar, você concorda com as políticas de segurança da sua organização.</p>
        </form>
      </section>
    </div>
  );
}
