import React, { useCallback, useEffect, useState } from 'react';

/**
 * Avisa quando existe uma versão nova publicada.
 *
 * O painel é uma aplicação de página única: quem deixa a aba aberta o dia todo
 * continua rodando o código carregado no primeiro acesso e não recebe correções até
 * recarregar na mão. Recarregar sozinho seria pior — descartaria uma mensagem sendo
 * digitada —, então o operador decide quando.
 *
 * A detecção compara o nome do bundle publicado com o que está em execução. O nome
 * carrega um hash do conteúdo, então muda a cada build; isso evita depender de um
 * arquivo de versão gerado à parte, que precisaria ser mantido em sincronia.
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function runningBundle(): string | null {
  if (typeof document === 'undefined') return null;
  const scripts = Array.from(document.querySelectorAll('script[src]'));
  const entry = scripts
    .map((script) => script.getAttribute('src') || '')
    .find((src) => /\/assets\/index-[^/]+\.js$/.test(src));
  return entry || null;
}

async function publishedBundle(): Promise<string | null> {
  // `no-store` é essencial: sem isso o navegador devolveria o index.html em cache e a
  // comparação nunca acusaria versão nova.
  const response = await fetch(`/index.html?ts=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) return null;
  const html = await response.text();
  const match = html.match(/\/assets\/index-[^"']+\.js/);
  return match ? match[0] : null;
}

const UpdateAvailable: React.FC = () => {
  const [outdated, setOutdated] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    try {
      const running = runningBundle();
      if (!running) return;
      const published = await publishedBundle();
      if (!published) return;
      // Compara só o nome do arquivo: o caminho pode variar entre origem e cache.
      const runningName = running.split('/').pop();
      const publishedName = published.split('/').pop();
      if (runningName && publishedName && runningName !== publishedName) {
        setOutdated(true);
      }
    } catch {
      // Sem rede não há o que avisar; a próxima verificação tenta de novo.
    }
  }, []);

  useEffect(() => {
    void check();
    const interval = window.setInterval(() => { void check(); }, CHECK_INTERVAL_MS);
    // O celular suspende timers em segundo plano: verificar ao voltar para a aba é o
    // que faz o aviso aparecer para quem usa o painel no telefone.
    const onVisible = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  if (!outdated || dismissed) return null;

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
      <div className="min-w-0">
        <p className="font-bold text-emerald-900 dark:text-emerald-100">Nova versão do painel disponível</p>
        <p className="mt-0.5 text-xs leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
          Recarregue para receber as correções mais recentes. Mensagens já enviadas não se perdem.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
        >
          Recarregar agora
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-xl px-2 py-2 text-xs font-bold text-emerald-900/70 dark:text-emerald-100/70"
          aria-label="Dispensar aviso de atualização"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default UpdateAvailable;
