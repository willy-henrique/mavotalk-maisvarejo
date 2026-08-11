import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { apiFetch, getApiUrl } from '../services/api';
import { AuthService } from '../services/authService';
import { UserRole } from '../types';
import { ErrorState, LoadingState } from './ui/PageState';
import { StatusBadge } from './ui/StatusBadge';

type WhatsappState = {
  status: 'idle' | 'initializing' | 'qr' | 'ready' | 'disconnected' | 'error';
  qrDataUrl: string | null;
  pairingCode: string | null;
  pairingPhone: string | null;
  pairingCodeIssuedAt: string | null;
  pairingCodeExpiresAt: string | null;
  lastPairingFailure: string | null;
  lastError: string | null;
  connectedPhone: string | null;
};

type StatusResponse = {
  provider: string;
  state: WhatsappState;
};

/** A operação é brasileira: o DDI vem preenchido para o operador digitar só DDD e número. */
const BRAZIL_DIAL_CODE = '55';

const DIAL_CODES: Array<{ code: string; label: string }> = [
  { code: '55', label: 'Brasil (+55)' },
  { code: '351', label: 'Portugal (+351)' },
  { code: '1', label: 'EUA / Canadá (+1)' },
  { code: '54', label: 'Argentina (+54)' },
  { code: '595', label: 'Paraguai (+595)' },
];

const whatsappStatusLabels: Record<WhatsappState['status'], string> = {
  idle: 'Aguardando conexão',
  initializing: 'Conectando',
  qr: 'QR Code disponível',
  ready: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Falha na conexão',
};

const Painel: React.FC = () => {
  const navigate = useNavigate();
  const session = AuthService.getSession();
  const isAdmin = session?.user?.role === UserRole.ADMIN || session?.user?.role === UserRole.SUPERVISOR;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [provider, setProvider] = useState<string>('');
  const [waState, setWaState] = useState<WhatsappState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [showPairing, setShowPairing] = useState(false);
  const [pairingPhoneInput, setPairingPhoneInput] = useState('');
  const [pairingCountry, setPairingCountry] = useState(BRAZIL_DIAL_CODE);

  // Número completo em E.164 sem o "+": o operador digita só DDD e número.
  const pairingFullNumber = `${pairingCountry}${pairingPhoneInput.replace(/\D/g, '')}`;
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const canAccess = AuthService.canAccessPainel();
  const statusRequestRef = useRef(0);

  const fetchStatus = useCallback(async (manual = false) => {
    const request = ++statusRequestRef.current;
    if (manual) setRefreshing(true);
    try {
      const res = await apiFetch('/api/whatsapp/status', { method: 'GET' });
      const data = await res.json().catch(() => ({})) as Partial<StatusResponse & { error?: string }>;
      if (!res.ok) throw new Error(data.error || 'Falha ao carregar o status da conexão.');
      if (!data.state || typeof data.provider !== 'string') throw new Error('O servidor retornou um status de conexão inválido.');
      if (request !== statusRequestRef.current) return;
      setProvider(data.provider);
      setWaState(data.state);
      setLastUpdated(new Date());
      setError(null);
    } catch (reason) {
      if (request !== statusRequestRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar o status da conexão.');
    } finally {
      if (request === statusRequestRef.current) {
        setLoading(false);
      }
      if (manual) setRefreshing(false);
    }
  }, []);

  // Um código vencido não conecta mais nada: esconder evita o operador digitar em vão.
  const activePairingCode =
    waState?.pairingCode &&
    (!waState.pairingCodeExpiresAt || new Date(waState.pairingCodeExpiresAt).getTime() > Date.now())
      ? waState.pairingCode
      : null;

  // Enquanto o QR está sendo gerado ou aguarda leitura, o estado muda em segundos:
  // revalidar de 10 em 10s faria o código aparecer tarde e expirar na tela.
  const pollIntervalMs = waState && ['initializing', 'qr'].includes(waState.status) ? 2000 : 10000;

  useEffect(() => {
    void fetchStatus();
    const interval = window.setInterval(() => void fetchStatus(), pollIntervalMs);
    return () => {
      window.clearInterval(interval);
      statusRequestRef.current += 1;
    };
  }, [fetchStatus, pollIntervalMs]);

  const handleConnect = async () => {
    setActionError(null);
    setConnecting(true);
    try {
      const res = await apiFetch('/api/whatsapp/connect', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 403 && (data as { error?: string }).error === 'Sem permissão') {
          setActionError('Sem permissão. Apenas admin ou gestor pode conectar.');
        } else {
          setActionError((data as { error?: string }).error || 'Falha ao conectar');
        }
      } else {
        await fetchStatus(true);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erro ao conectar');
    } finally {
      setConnecting(false);
    }
  };

  const handlePairingCode = async () => {
    setActionError(null);
    setPairing(true);
    try {
      const res = await apiFetch('/api/whatsapp/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pairingFullNumber }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setActionError(data.error || 'Falha ao gerar o código de pareamento');
      }
      await fetchStatus(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erro ao gerar o código');
    } finally {
      setPairing(false);
    }
  };

  const handleDisconnect = async () => {
    setActionError(null);
    setDisconnecting(true);
    try {
      const res = await apiFetch('/api/whatsapp/disconnect', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 403 && (data as { error?: string }).error === 'Sem permissão') {
          setActionError('Sem permissão.');
        } else {
          setActionError((data as { error?: string }).error || 'Falha ao desconectar');
        }
      } else {
        await fetchStatus(true);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erro ao desconectar');
    } finally {
      setDisconnecting(false);
    }
  };

  if (!canAccess) {
    return <Navigate to="/inbox" replace />;
  }

  if (loading) {
    return (
      <main className="mavo-page"><div className="mavo-page-content"><LoadingState title="Carregando central de conexão…" description="Verificando o provedor e o estado atual do WhatsApp." /></div></main>
    );
  }

  return (
    <main className="mavo-page"><div className="mavo-page-content max-w-6xl">
      <div className="mb-6 overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-xl shadow-slate-950/10 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Área do administrador
          </span>
          <h2 className="mt-4 text-2xl font-black tracking-tight">Central de conexão</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Conecte o WhatsApp, acompanhe o estado da sessão e acesse as configurações que sustentam a operação.</p>
          </div>
          <button type="button" onClick={() => void fetchStatus(true)} disabled={refreshing || connecting || disconnecting} className="mavo-button border border-white/15 bg-white/10 text-white hover:bg-white/15">{refreshing ? 'Atualizando…' : 'Atualizar status'}</button>
        </div>
      </div>

      <div>
        {error && <ErrorState className="mb-6" title="Não foi possível atualizar a conexão." description={error} action={<button type="button" onClick={() => void fetchStatus(true)} disabled={refreshing || connecting || disconnecting} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}

        {actionError && (
          <div role="alert" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {actionError}
          </div>
        )}

        <div className="mavo-card overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">Conexão WhatsApp</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Provedor: <span className="font-semibold text-slate-700 dark:text-slate-200">{provider || 'não informado'}</span>
            </p>
            </div><StatusBadge tone={waState?.status === 'ready' ? 'success' : 'warning'}>{waState?.status === 'ready' ? 'Conectado' : 'Ação necessária'}</StatusBadge></div>
          </div>
          <div className="p-6">
            <p className="mb-4 font-semibold text-slate-800 dark:text-slate-100">
              Status: <span className="font-normal text-slate-600 dark:text-slate-300">{whatsappStatusLabels[waState?.status ?? 'idle']}</span>
            </p>
            {waState?.connectedPhone && (
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
                Conectado: <span className="font-medium">{waState.connectedPhone}</span>
              </p>
            )}
            {waState?.lastError && (
              <p role="alert" className="mb-4 text-sm text-rose-600 dark:text-rose-300">{waState.lastError}</p>
            )}

            {/* Sobrevive ao auto-reconnect, que zera lastError segundos depois da queda. */}
            {waState?.lastPairingFailure && waState.lastPairingFailure !== waState.lastError && (
              <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                {waState.lastPairingFailure}
              </p>
            )}

            {provider === 'unofficial' && (
              <>
                {waState?.qrDataUrl && (
                  <div className="mb-6 flex justify-center rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
                    <img
                      src={waState.qrDataUrl}
                      alt="QR Code WhatsApp"
                      className="w-[180px] h-[180px] rounded-xl border border-slate-200"
                    />
                  </div>
                )}
                {activePairingCode && (
                  <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Código de pareamento{waState?.pairingPhone ? ` — ${waState.pairingPhone}` : ''}
                    </p>
                    <p className="mt-2 font-mono text-3xl font-black tracking-[0.2em] text-slate-800 dark:text-slate-100">
                      {/* O WhatsApp mostra o código em dois blocos de 4; espelhar isso evita erro de digitação. */}
                      {activePairingCode.length === 8
                        ? `${activePairingCode.slice(0, 4)}-${activePairingCode.slice(4)}`
                        : activePairingCode}
                    </p>
                    <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      No celular: <strong>WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho &gt; Conectar com número de telefone</strong> e digite o código acima. Se ele expirar, gere outro.
                    </p>
                    {waState?.pairingCodeIssuedAt && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Gerado às{' '}
                        <span className="font-mono">
                          {new Date(waState.pairingCodeIssuedAt).toLocaleTimeString('pt-BR')}
                        </span>
                        . O código vale enquanto esta sessão de conexão estiver ativa — se demorar, gere outro antes de digitar.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={handleConnect}
                    disabled={connecting || waState?.status === 'initializing'}
                    className="mavo-button-primary"
                  >
                    {connecting || waState?.status === 'initializing' ? 'Aguarde...' : 'Gerar QR'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPairing((open) => !open)}
                    aria-expanded={showPairing}
                    className="mavo-button-secondary"
                  >
                    Conectar por código
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="mavo-button-secondary"
                  >
                    {disconnecting ? 'Desconectando...' : 'Desconectar'}
                  </button>
                </div>

                {showPairing && (
                  <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                    <label htmlFor="pairing-phone" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Número do WhatsApp que será conectado
                    </label>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Use quando a câmera do aparelho não conseguir ler o QR. Digite DDD e número exatamente como aparecem no perfil do WhatsApp do aparelho.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <select
                        aria-label="País"
                        value={pairingCountry}
                        onChange={(e) => setPairingCountry(e.target.value)}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {DIAL_CODES.map((item) => (
                          <option key={item.code} value={item.code}>{item.label}</option>
                        ))}
                      </select>
                      <div className="flex min-w-[220px] flex-1 items-center rounded-xl border border-slate-300 px-3 dark:border-slate-600 dark:bg-slate-900">
                        <span className="mr-2 font-mono text-sm text-slate-500 dark:text-slate-400">+{pairingCountry}</span>
                        <input
                          id="pairing-phone"
                          type="tel"
                          inputMode="numeric"
                          value={pairingPhoneInput}
                          onChange={(e) => setPairingPhoneInput(e.target.value)}
                          placeholder="62 98412-7954"
                          className="w-full bg-transparent py-2 text-sm outline-none dark:text-slate-100"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handlePairingCode}
                        disabled={pairing || pairingFullNumber.length < 10 || pairingFullNumber.length > 15}
                        className="mavo-button-primary"
                      >
                        {pairing ? 'Gerando...' : 'Gerar código'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Será pareado: <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">+{pairingFullNumber}</span>
                    </p>
                  </div>
                )}
              </>
            )}

            {provider !== 'unofficial' && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                A conexão é gerenciada pelo provedor {provider || 'configurado'}. QR Code só é necessário para a integração Baileys.
              </p>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-black text-slate-800 dark:text-white">Configurações administrativas</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <button
                type="button"
                onClick={() => navigate('/admin/usuarios')}
                className="mavo-card p-4 text-left transition hover:border-blue-300 hover:shadow-md dark:hover:border-blue-800"
              >
                <span className="font-bold text-slate-800 block">Equipe</span>
                <span className="text-sm text-slate-500">Criar e gerenciar colaboradores</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/tipos')}
                className="mavo-card p-4 text-left transition hover:border-blue-300 hover:shadow-md dark:hover:border-blue-800"
              >
                <span className="block font-bold text-slate-800 dark:text-slate-100">Filas e automações</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">Menu do bot, cores e SLAs</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/respostas-rapidas')}
                className="mavo-card p-4 text-left transition hover:border-blue-300 hover:shadow-md dark:hover:border-blue-800"
              >
                <span className="font-bold text-slate-800 block">Respostas rápidas</span>
                <span className="text-sm text-slate-500">Atalhos e variáveis globais</span>
              </button>
              <button
                type="button"
                onClick={() => { window.location.href = getApiUrl('/mavo'); }}
                className="mavo-card p-4 text-left transition hover:border-blue-300 hover:shadow-md dark:hover:border-blue-800"
              >
                <span className="font-bold text-slate-800 dark:text-slate-100 block">Configuração do Mavo</span>
                <span className="text-sm text-slate-500">Ofertas, horários, localização e bot</span>
              </button>
            </div>
          </div>
        )}
        {lastUpdated && <p className="mt-6 text-xs text-slate-400">Status atualizado às {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>}
      </div>
      </div></main>
  );
};

export default Painel;
