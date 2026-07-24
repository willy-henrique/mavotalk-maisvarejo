import React, { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';
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
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
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
    <div className="flex-1 overflow-auto bg-slate-50 min-h-full">
      {/* Header Área Admin */}
      <div className="bg-slate-900 text-white px-8 py-6 border-b border-slate-700">
        <div className="max-w-4xl flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold uppercase tracking-wider">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Área do administrador
          </span>
          <h1 className="text-2xl font-black tracking-tight">Painel Mavo Talk</h1>
        </div>
        <p className="max-w-4xl mt-2 text-slate-400 text-sm">
          Conexão WhatsApp e configurações restritas a administradores e gestores.
        </p>
      </div>

      <div className="p-8 max-w-2xl">
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

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-100 px-6 py-3 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Conexão WhatsApp</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              Provider: <span className="font-semibold text-slate-700">{provider}</span>
            </p>
          </div>
          <div className="p-6">
            <p className="text-slate-800 font-semibold mb-4">
              Status: <span className="text-slate-600 font-normal">{waState?.status ?? 'idle'}</span>
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
            <h2 className="text-lg font-bold text-slate-800 mb-4">Configurações Administrativas</h2>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Painel;
