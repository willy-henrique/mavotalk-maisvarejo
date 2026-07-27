import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icons } from '../constants';
import { User, UserRole } from '../types';

type WhatsappStatus = 'idle' | 'initializing' | 'qr' | 'ready' | 'disconnected' | 'error';

const pageMeta: Array<{ match: string; title: string; description: string; section: string }> = [
  { match: '/business/sincronizacao', title: 'Agentes e sincronização', description: 'Provisione, monitore e acompanhe a entrada segura de dados.', section: 'Administração' },
  { match: '/business/auditoria', title: 'Auditoria gerencial', description: 'Rastreabilidade das consultas do negócio.', section: 'Administração' },
  { match: '/admin/acessos-gerenciais', title: 'Acessos gerenciais', description: 'Controle quem pode consultar indicadores pelo WhatsApp.', section: 'Administração' },
  { match: '/admin/respostas-rapidas', title: 'Respostas rápidas', description: 'Padronize respostas e reduza o tempo de atendimento.', section: 'Administração' },
  { match: '/admin/usuarios', title: 'Equipe', description: 'Convide e organize as pessoas da operação.', section: 'Administração' },
  { match: '/admin/tipos', title: 'Filas e automações', description: 'Configure o menu, prioridade visual e SLA do atendimento.', section: 'Administração' },
  { match: '/admin/agentes', title: 'Agentes cloud', description: 'Conecte a sincronização do ambiente do cliente.', section: 'Administração' },
  { match: '/admin/menu-visibilidade', title: 'Menu do painel', description: 'Defina a visibilidade da navegação sem alterar permissões de acesso.', section: 'Administração' },
  { match: '/dashboard', title: 'Visão de atendimento', description: 'Acompanhe a operação, filas e tempo de resposta.', section: 'Operação' },
  { match: '/business', title: 'Indicadores do negócio', description: 'Vendas, produtos e estoque sincronizados.', section: 'Operação' },
  { match: '/contacts', title: 'Relacionamento com clientes', description: 'Contexto, notas e histórico de cada contato.', section: 'Operação' },
  { match: '/painel', title: 'Central de conexão', description: 'Status do WhatsApp e atalhos administrativos.', section: 'Operação' },
  { match: '/inbox', title: 'Caixa de entrada', description: 'Conversas em tempo real da sua equipe.', section: 'Operação' },
];

function currentMeta(pathname: string) {
  return pageMeta.find((item) => pathname === item.match || pathname.startsWith(`${item.match}/`)) ?? pageMeta[pageMeta.length - 1];
}

type Props = {
  user: User;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenMenu: () => void;
  onLogout: () => void;
  whatsappStatus: WhatsappStatus | null;
  whatsappProvider: string;
};

export default function AppHeader({ user, theme, onToggleTheme, onOpenMenu, onLogout, whatsappStatus, whatsappProvider }: Props) {
  const { pathname } = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const meta = currentMeta(pathname);
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((value) => value[0]).join('').toUpperCase() || 'MT';
  const whatsappReady = whatsappProvider === 'twilio' || whatsappStatus === 'ready';
  const canManageWhatsapp = user.role !== UserRole.AGENT;

  useEffect(() => {
    const closeMenu = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        setUserMenuOpen(false);
      } else if (event instanceof MouseEvent && !userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeMenu);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeMenu);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 flex min-h-[76px] shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onOpenMenu} className="rounded-xl p-2.5 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden" aria-label="Abrir navegação">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M3.75 5.25a.75.75 0 0 0 0 1.5h16.5a.75.75 0 0 0 0-1.5H3.75Zm0 6a.75.75 0 0 0 0 1.5h16.5a.75.75 0 0 0 0-1.5H3.75Zm0 6a.75.75 0 0 0 0 1.5h16.5a.75.75 0 0 0 0-1.5H3.75Z" /></svg>
        </button>
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.16em] text-slate-400"><span className="hidden sm:inline">{meta.section}</span><span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline" /><span className="truncate">Mavo Talk</span></div>
          <h1 className="truncate text-base font-black tracking-tight text-slate-900 dark:text-white sm:text-lg">{meta.title}</h1>
          <p className="hidden truncate text-xs text-slate-500 dark:text-slate-400 lg:block">{meta.description}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {canManageWhatsapp && (
          <Link to="/painel" className={`hidden items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition sm:flex ${whatsappReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300'}`}>
            <span className={`h-2 w-2 rounded-full ${whatsappReady ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {whatsappReady ? 'WhatsApp ativo' : whatsappStatus === 'initializing' || whatsappStatus === 'qr' ? 'Conectando' : 'WhatsApp offline'}
          </Link>
        )}
        <button type="button" onClick={onToggleTheme} className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white" aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}>{theme === 'dark' ? <span className="text-base">☀</span> : <span className="text-base">◐</span>}</button>
        <div ref={userMenuRef} className="relative">
          <button type="button" onClick={() => setUserMenuOpen((open) => !open)} className="flex items-center gap-2 rounded-xl p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Menu do usuário" aria-expanded={userMenuOpen} aria-controls="user-actions-menu">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-black text-white shadow-lg shadow-blue-500/20">{initials}</span>
            <span className="hidden max-w-28 truncate text-left text-xs font-bold text-slate-700 dark:text-slate-200 lg:block">{user.name}</span>
          </button>
          <div id="user-actions-menu" role="menu" className={`${userMenuOpen ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-1 opacity-0'} absolute right-0 top-full z-50 mt-2 w-48 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl transition dark:border-slate-700 dark:bg-slate-900`}>
            <p className="px-3 py-2 text-xs text-slate-500">{user.email}</p>
            <button type="button" role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"><Icons.Settings className="h-4 w-4" /> Sair do sistema</button>
          </div>
        </div>
      </div>
    </header>
  );
}
