import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Icons } from './constants';
import { useTheme } from './contexts/ThemeContext';
import Sidebar from './components/Sidebar';
import InboxConversations from './components/InboxConversations';
import Dashboard from './components/Dashboard';
import Vault from './components/Vault';
import UserManagement from './components/Admin/UserManagement';
import TicketTypeManagement from './components/Admin/TicketTypeManagement';
import QuickReplyManagement from './components/Admin/QuickReplyManagement';
import Contacts from './components/Contacts';
import Painel from './components/Painel';
import { AuthState, UserRole } from './types';
import { mockTickets } from './services/mockData';
import { AuthService } from './services/authService';
import { apiFetch } from './services/api';

type WhatsappStatus = 'idle' | 'initializing' | 'qr' | 'ready' | 'disconnected' | 'error';

const App: React.FC = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [session, setSession] = useState<AuthState | null>(AuthService.getSession());
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [tickets, setTickets] = useState(mockTickets);
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsappStatus | null>(null);
  const [whatsappProvider, setWhatsappProvider] = useState<string>('');

  useEffect(() => {
    if (session?.isAuthenticated) {
      AuthService.refreshSession().then((refreshed) => {
        if (refreshed) setSession(refreshed);
      });
    }
  }, []);

  useEffect(() => {
    if (!session?.isAuthenticated) return;
    const fetchStatus = async () => {
      try {
        const res = await apiFetch('/api/whatsapp/status', { method: 'GET' });
        const data = await res.json();
        if (res.ok && data?.state?.status != null) {
          setWhatsappStatus(data.state.status);
          setWhatsappProvider(data.provider || '');
        }
      } catch {
        setWhatsappStatus(null);
      }
    };
    fetchStatus();
    const t = setInterval(fetchStatus, 10000);
    return () => clearInterval(t);
  }, [session?.isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');
    try {
      const data = await AuthService.login(loginEmail, loginPass);
      setSession(data);
      navigate('/inbox', { replace: true });
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Erro ao autenticar');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await AuthService.logout();
    setSession(null);
  };

  if (!session?.isAuthenticated || !session.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900 px-4 transition-colors">
        <div className="max-w-md w-full bg-white rounded-[32px] p-10 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-6 shadow-xl shadow-blue-500/20">
              <Icons.Inbox className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">WillTalk</h1>
            <p className="text-slate-500 mt-2 font-medium">Suporte em tempo real para empresas.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2 ml-1">E-mail corporativo</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all"
                placeholder="nome@willtalk.com"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2 ml-1">Senha</label>
              <input
                type="password"
                required
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all"
                placeholder="••••••••"
              />
            </div>

            {loginError && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-sm font-bold animate-in shake duration-300">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 disabled:opacity-50"
            >
              {isLoggingIn ? 'Autenticando...' : 'Acessar Painel'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
      <div className="flex h-screen w-full bg-slate-100 dark:bg-slate-800 overflow-hidden min-w-0 transition-colors">
        <Sidebar user={session.user} />

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50 dark:bg-slate-800/95 transition-colors relative z-0">
          <header className="h-16 bg-blue-600 dark:bg-[#1e3a5f] text-white px-6 flex items-center justify-between shrink-0 shadow-lg transition-colors">
            <div className="flex items-center gap-4 min-w-0">
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-white/10 transition-colors shrink-0"
                aria-label="Menu"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M3 6.75A.75.75 0 013.75 6h16.5a.75.75 0 010 1.5H3.75A.75.75 0 013 6.75zM3 12a.75.75 0 01.75-.75h16.5a.75.75 0 010 1.5H3.75A.75.75 0 013 12zm0 5.25a.75.75 0 01.75-.75h16.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                </svg>
              </button>
              <p className="text-sm font-semibold truncate">
                Olá {session.user.name?.split(' ')[0] || 'Usuário'}, seja bem-vindo ao WillTalk!{' '}
                <span className="text-white/80 font-normal">(Ativo)</span>
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="p-2.5 rounded-lg hover:bg-white/10 transition-colors" aria-label="Notificações">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.206A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
                </svg>
              </button>
              <button type="button" className="p-2.5 rounded-lg hover:bg-white/10 transition-colors" aria-label="Conversas">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97-1.94.284-3.916.455-5.922.505a.803.803 0 00-.921.921 11.447 11.447 0 01.505 5.922c.292 1.978 2.024 3.348 3.97 3.348h6.02c1.946 0 3.678-1.37 3.97-3.348.284-1.94.455-3.916.505-5.922a.803.803 0 00-.921-.921 11.447 11.447 0 01-5.922-.505C18.318 18.37 16.586 17 14.63 17h-6.02c-1.946 0-3.678 1.37-3.97 3.348a11.464 11.464 0 01-.505 5.922.803.803 0 00.921.921 11.446 11.446 0 005.922.505c1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946 1.37 3.678 3.348 3.97C17.183 21.822 19.57 22 22 22s4.817-.178 7.152-.52c1.978-.292 3.348-2.024 3.348-3.97v-6.02c0-1.946-1.37-3.678-3.348-3.97a11.464 11.464 0 01-.505-5.922.803.803 0 00-.921-.921 11.446 11.446 0 01-5.922-.505C18.318 5.63 16.586 7 14.63 7h-6.02C6.664 7 5.932 5.67 5.646 3.672A49.19 49.19 0 015.073 2.25H4.752a.75.75 0 00-.612.52 48.518 48.518 0 01-.292 2.001z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2.5 rounded-lg hover:bg-white/10 transition-colors"
                aria-label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
                title={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              >
                {theme === 'dark' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-.291.027-.585.041-.885.041-5.523 0-10-4.477-10-10 0-.3.014-.594.041-.885a10.503 10.503 0 016.46-9.694.75.75 0 01.818.162z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                  whatsappProvider === 'twilio' || whatsappStatus === 'ready' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/80'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${whatsappProvider === 'twilio' || whatsappStatus === 'ready' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-xs font-semibold">
                  {whatsappProvider === 'twilio' || whatsappStatus === 'ready' ? 'WhatsApp ativo' : whatsappStatus === 'qr' || whatsappStatus === 'initializing' ? 'Conectando...' : 'Desconectado'}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="p-2.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                aria-label="Sair"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M7.5 3.75A1.5 1.5 0 006 5.25v13.5a1.5 1.5 0 001.5 1.5h6a1.5 1.5 0 001.5-1.5V15a.75.75 0 011.5 0v3.75a3 3 0 01-3 3h-6a3 3 0 01-3-3V5.25a3 3 0 013-3h6a3 3 0 013 3V9A.75.75 0 0115 9V5.25a1.5 1.5 0 00-1.5-1.5h-6zm5.03 4.72a.75.75 0 010 1.06l-1.72 1.72h10.94a.75.75 0 010 1.5H10.81l1.72 1.72a.75.75 0 11-1.06 1.06l-3-3a.75.75 0 010-1.06l3-3a.75.75 0 011.06 0z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </header>

          <Routes>
            <Route path="/" element={<Navigate to="/inbox" replace />} />
            <Route
              path="/inbox"
              element={<InboxConversations currentUser={session.user} />}
            />
            <Route path="/dashboard" element={session.user.role === UserRole.AGENT ? <Navigate to="/inbox" replace /> : <Dashboard tickets={tickets} />} />
            <Route path="/vault" element={<Vault tickets={tickets} />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/admin/usuarios" element={<UserManagement />} />
            <Route path="/admin/tipos" element={<TicketTypeManagement />} />
            <Route path="/admin/respostas-rapidas" element={<QuickReplyManagement />} />
            <Route path="/painel" element={<Painel />} />
            <Route path="*" element={<Navigate to="/inbox" replace />} />
          </Routes>
        </main>
      </div>
  );
};

export default App;
