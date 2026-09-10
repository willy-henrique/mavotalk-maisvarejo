import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icons } from '../constants';
import { User, UserRole } from '../types';
import { AuthService } from '../services/authService';
import { apiFetch } from '../services/api';

interface SidebarProps {
  user: User;
  mobileOpen?: boolean;
  onNavigate?: () => void;
}

type MenuPolicyResponse = {
  visibility?: Record<string, boolean>;
  permissions?: Record<string, { read?: boolean }>;
};

const TAB_BY_PATH: Record<string, string> = {
  '/inbox': 'inbox',
  '/dashboard': 'dashboard',
  '/business/sincronizacao': 'business_sync',
  '/business/auditoria': 'business_audit',
  '/contacts': 'contacts',
  '/meu-espaco': 'personal_workspace',
  '/admin/usuarios': 'admin_users',
  '/admin/tipos': 'admin_types',
  '/admin/pedidos': 'admin_orders',
  '/admin/respostas-rapidas': 'admin_quick_replies',
  '/admin/acessos-gerenciais': 'admin_business_access',
  '/admin/agentes': 'admin_agents',
  '/admin/menu-visibilidade': 'admin_menu_settings',
  '/painel': 'painel',
  '/admin/acessos-remotos': 'remote_accesses',
  '/acessos-remotos': 'remote_accesses',
};

const menuItems = [
  { id: 'inbox', label: 'Inbox', icon: Icons.Inbox, path: '/inbox', role: 'ANY' as const },
  { id: 'contacts', label: 'Contatos', icon: Icons.Users, path: '/contacts', role: 'ANY' as const },
  { id: 'personal_workspace', label: 'Meu espaço', icon: Icons.Inbox, path: '/meu-espaco', role: 'ANY' as const },
  { id: 'remote_accesses', label: 'Acessos remotos', icon: Icons.Vault, path: '/admin/acessos-remotos', role: 'ANY' as const },
  { id: 'mavo_gestao', label: 'Mavo Gestão', icon: Icons.ExternalLink, path: 'https://bloco-maisvarejo.vercel.app/', role: 'ANY' as const, isExternal: true },
  { id: 'dashboard', label: 'Visão da operação', icon: Icons.Chart, path: '/dashboard', role: 'METRICS' as const },
  { id: 'mavo_metricas', label: 'Métricas do Suporte', icon: Icons.Chart, path: 'https://mavo-metricas.vercel.app/', role: 'METRICS' as const, isExternal: true },
  { id: 'painel', label: 'Conexão WhatsApp', icon: Icons.QrCode, path: '/painel', role: 'PAINEL' as const },
  { id: 'admin_types', label: 'Filas e automações', icon: Icons.Settings, path: '/admin/tipos', role: UserRole.ADMIN },
  { id: 'admin_users', label: 'Equipe', icon: Icons.Users, path: '/admin/usuarios', role: UserRole.ADMIN },
  { id: 'admin_business_access', label: 'Acessos gerenciais', icon: Icons.Users, path: '/admin/acessos-gerenciais', role: UserRole.ADMIN },
  { id: 'admin_orders', label: 'Pedidos', icon: Icons.Inbox, path: '/admin/pedidos', role: UserRole.ADMIN },
  { id: 'admin_quick_replies', label: 'Respostas rápidas', icon: Icons.Settings, path: '/admin/respostas-rapidas', role: UserRole.ADMIN },
  { id: 'admin_menu_settings', label: 'Menu do painel', icon: Icons.Settings, path: '/admin/menu-visibilidade', role: UserRole.ADMIN },
];

const OPERATIONAL_ITEMS = ['inbox', 'contacts', 'personal_workspace', 'remote_accesses', 'mavo_gestao'];

const Sidebar: React.FC<SidebarProps> = ({ user, mobileOpen = false, onNavigate }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const activeTab = TAB_BY_PATH[pathname] ?? 'inbox';
  const [collapsed, setCollapsed] = useState(false);
  const [visibilityOverrides, setVisibilityOverrides] = useState<Record<string, boolean> | null>(null);
  const [permissions, setPermissions] = useState<Record<string, { read?: boolean }> | null>(null);
  const [menuSettingsError, setMenuSettingsError] = useState('');
  const menuPolicyRequestRef = useRef(0);

  const loadMenuPolicy = useCallback(async () => {
    const request = ++menuPolicyRequestRef.current;
    setMenuSettingsError('');
    try {
      const response = await apiFetch('/api/menu-settings', { method: 'GET' });
      if (!response.ok) throw new Error('Não foi possível carregar a política de navegação.');
      const data = await response.json() as MenuPolicyResponse;
      if (!data?.visibility) throw new Error('A política de navegação retornou dados incompletos.');
      if (request !== menuPolicyRequestRef.current) return;
      setVisibilityOverrides(data.visibility);
      setPermissions(data.permissions || {});
    } catch (reason) {
      if (request !== menuPolicyRequestRef.current) return;
      setVisibilityOverrides(null);
      setPermissions(null);
      setMenuSettingsError(reason instanceof Error ? reason.message : 'Não foi possível carregar a política de navegação.');
    }
  }, []);

  useEffect(() => {
    void loadMenuPolicy();
    return () => { menuPolicyRequestRef.current += 1; };
  }, [loadMenuPolicy]);

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'MT';

  const canSee = (item: (typeof menuItems)[0]) => {
    if (item.id === 'mavo_gestao') return true;
    if (item.id === 'mavo_metricas') return user.role === UserRole.SUPERVISOR || user.role === UserRole.ADMIN;
    const roleAllowed = item.role === 'ANY'
      || (item.role === 'PAINEL' && AuthService.canAccessPainel())
      || (item.role === 'METRICS' && (user.role === UserRole.SUPERVISOR || user.role === UserRole.ADMIN))
      || user.role === item.role;

    if (!visibilityOverrides || !permissions) return roleAllowed;
    return Boolean(visibilityOverrides[item.id]) && Boolean(permissions[item.id]?.read);
  };

  const handleItemClick = (item: (typeof menuItems)[0]) => {
    if (item.isExternal) {
      window.open(item.path, '_blank', 'noopener,noreferrer');
      onNavigate?.();
      return;
    }
    navigate(item.path);
    onNavigate?.();
  };

  return (
    <aside
      className={`${collapsed ? 'md:w-20' : 'md:w-64'} w-64 fixed inset-y-0 left-0 md:relative md:inset-auto ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} bg-white/95 dark:bg-slate-950/95 text-slate-600 dark:text-slate-400 flex flex-col transition-all duration-300 z-[60] shadow-2xl dark:shadow-black/30 shrink-0 border-r border-slate-200/80 dark:border-slate-800 backdrop-blur-xl`}
    >
      <div className="p-4 flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-blue-500/20">
            <Icons.Inbox className="w-6 h-6" />
          </div>
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <h1 className="text-slate-800 dark:text-white font-black text-xl tracking-tighter truncate">Mavo Talk</h1>
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-widest leading-none">Atendimento inteligente</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="shrink-0 relative z-10 p-2 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/30 transition-colors"
          title={collapsed ? 'Abrir menu' : 'Fechar menu'}
          aria-label={collapsed ? 'Abrir menu' : 'Fechar menu'}
        >
          {collapsed ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.06l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.06l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-1 mt-4 overflow-x-hidden" aria-label="Navegação principal">
        {!collapsed && <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[.18em] text-slate-400">Operação</p>}
        {menuItems.filter((item) => OPERATIONAL_ITEMS.includes(item.id)).filter(canSee).map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleItemClick(item)}
              className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-2xl transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/20'
                  : 'hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
              } ${collapsed ? 'justify-center' : ''}`}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
            >
              <item.icon className={`w-6 h-6 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-500'}`} />
              {!collapsed && (
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span className="font-bold text-sm truncate">{item.label}</span>
                  {item.isExternal && (
                    <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider ml-1">
                      Abrir
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
        {!collapsed && <p className="px-3 pb-2 pt-6 text-[10px] font-black uppercase tracking-[.18em] text-slate-400">Administração</p>}
        {menuItems.filter((item) => !OPERATIONAL_ITEMS.includes(item.id)).filter(canSee).map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => handleItemClick(item)} className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all ${isActive ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/20' : 'hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'} ${collapsed ? 'justify-center' : ''}`} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined}>
              <item.icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-500'}`} />
              {!collapsed && <span className="font-bold text-sm truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {menuSettingsError && (
        <div className="mx-3 mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100" role="status">
          {collapsed ? (
            <button type="button" onClick={() => void loadMenuPolicy()} className="mavo-button-secondary min-h-0 w-full px-2 py-2 text-xs" aria-label="Tentar carregar permissões do menu">Tentar</button>
          ) : (
            <><p className="font-bold">Permissões do menu indisponíveis</p><p className="mt-1 leading-5">Exibindo apenas o acesso padrão enquanto a política é atualizada.</p><button type="button" onClick={() => void loadMenuPolicy()} className="mt-2 font-bold underline underline-offset-2">Tentar novamente</button></>
          )}
        </div>
      )}

      <div className={`p-4 border-t border-slate-200 dark:border-slate-800 ${collapsed ? 'flex flex-col items-center' : ''}`}>
        <div className={`flex items-center gap-3 p-3 rounded-2xl bg-slate-100/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 ${collapsed ? 'justify-center' : ''}`}>
          <div
            className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200 shrink-0 border-2 border-blue-200 dark:border-blue-800 shadow-sm flex items-center justify-center text-xs font-black"
            aria-label={`Usuário ${user.name}`}
          >
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate leading-none mb-1">{user.name}</p>
              <p className="text-[10px] font-black text-blue-600 dark:text-blue-500 uppercase tracking-wider">{user.role}</p>
            </div>
          )}
        </div>
        <div className={`mt-3 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-1'} text-[11px] font-semibold text-slate-400 dark:text-slate-500`}>
          {!collapsed ? (
            <>
              <span className="tracking-tight">Mavo Talk</span>
              <span className="rounded-md bg-slate-200/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                v0.8.1
              </span>
            </>
          ) : (
            <span className="font-mono text-[10px] font-bold tracking-tight text-slate-500">v0.8.1</span>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
