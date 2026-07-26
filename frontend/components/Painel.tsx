import React, { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { apiFetch, getApiUrl } from '../services/api';
import { AuthService } from '../services/authService';
import { UserRole } from '../types';

type WhatsappState = {
  status: 'idle' | 'initializing' | 'qr' | 'ready' | 'disconnected' | 'error';
  qrDataUrl: string | null;
  lastError: string | null;
  connectedPhone: string | null;
};

type StatusResponse = {
  provider: string;
  state: WhatsappState;
};

const Painel: React.FC = () => {
  const navigate = useNavigate();
  const session = AuthService.getSession();
  const isAdmin = session?.user?.role === UserRole.ADMIN || session?.user?.role === UserRole.SUPERVISOR;
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<string>('');
  const [waState, setWaState] = useState<WhatsappState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const canAccess = AuthService.canAccessPainel();

  const fetchStatus = useCallback(async () => {
    setError(null);
    const res = await apiFetch('/api/whatsapp/status', { method: 'GET' });
    const data = (await res.json()) as StatusResponse;
    if (!res.ok) {
      setError((data as { error?: string }).error || 'Falha ao carregar status');
      setLoading(false);
      return;
    }
    setProvider(data.provider);
    setWaState(data.state);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = window.setInterval(() => void fetchStatus(), 10000);
    return () => window.clearInterval(interval);
  }, [fetchStatus]);

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
        await fetchStatus();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erro ao conectar');
    } finally {
      setConnecting(false);
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
        await fetchStatus();
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
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-50">
        <p className="text-slate-500 font-medium">Carregando área administrativa...</p>
      </div>
    );
  }

  return (
    <div className="min-h-full flex-1 overflow-auto bg-slate-50 p-5 dark:bg-slate-800/95 sm:p-8">
      <div className="mx-auto max-w-5xl">
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
          <button type="button" onClick={() => void fetchStatus()} className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/15">Atualizar status</button>
        </div>
      </div>

      <div className="max-w-3xl">
        {error && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm">
            {error}
          </div>
        )}

        {actionError && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-sm">
            {actionError}
          </div>
        )}

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">Conexão WhatsApp</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Provider: <span className="font-semibold text-slate-700">{provider}</span>
            </p>
            </div><span className={`rounded-full px-3 py-1.5 text-xs font-black ${waState?.status === 'ready' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'}`}>{waState?.status === 'ready' ? 'Conectado' : 'Ação necessária'}</span></div>
          </div>
          <div className="p-6">
            <p className="mb-4 text-slate-800 dark:text-slate-100 font-semibold">
              Status: <span className="font-normal text-slate-600 dark:text-slate-300">{waState?.status ?? 'idle'}</span>
            </p>
            {waState?.connectedPhone && (
              <p className="text-slate-600 text-sm mb-4">
                Conectado: <span className="font-medium">{waState.connectedPhone}</span>
              </p>
            )}
            {waState?.lastError && (
              <p className="text-rose-600 text-sm mb-4">{waState.lastError}</p>
            )}

            {provider === 'unofficial' && (
              <>
                {waState?.qrDataUrl && (
                  <div className="mb-6 flex justify-center p-4 bg-slate-50 rounded-xl">
                    <img
                      src={waState.qrDataUrl}
                      alt="QR Code WhatsApp"
                      className="w-[180px] h-[180px] rounded-xl border border-slate-200"
                    />
                  </div>
                )}
                <div className="flex gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={handleConnect}
                    disabled={connecting || waState?.status === 'initializing'}
                    className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 disabled:opacity-50 transition-all"
                  >
                    {connecting || waState?.status === 'initializing' ? 'Aguarde...' : 'Gerar QR'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 disabled:opacity-50 transition-all"
                  >
                    {disconnecting ? 'Desconectando...' : 'Desconectar'}
                  </button>
                </div>
              </>
            )}

            {provider !== 'unofficial' && (
              <p className="text-slate-500 text-sm">
                O QR Code está disponível apenas quando o provider é &quot;unofficial&quot;.
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
                className="p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-left transition-all"
              >
                <span className="font-bold text-slate-800 block">Equipe</span>
                <span className="text-sm text-slate-500">Criar e gerenciar colaboradores</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/tipos')}
                className="p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-left transition-all"
              >
                <span className="font-bold text-slate-800 block">Tipos de Ticket</span>
                <span className="text-sm text-slate-500">Categorias, cores e SLAs</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/respostas-rapidas')}
                className="p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-left transition-all"
              >
                <span className="font-bold text-slate-800 block">Respostas Rápidas</span>
                <span className="text-sm text-slate-500">Atalhos e variáveis globais</span>
              </button>
              <button
                type="button"
                onClick={() => { window.location.href = getApiUrl('/mavo'); }}
                className="p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-left transition-all dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                <span className="font-bold text-slate-800 dark:text-slate-100 block">Configuração do Mavo</span>
                <span className="text-sm text-slate-500">Ofertas, horários, localização e bot</span>
              </button>
            </div>
          </div>
        )}
        {lastUpdated && <p className="mt-6 text-xs text-slate-400">Atualizado às {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>}
      </div>
      </div>
    </div>
  );
};

export default Painel;
