import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icons } from '../constants';
import { User, UserRole } from '../types';
import { AuthService } from '../services/authService';

interface SidebarProps {
  user: User;
}

const TAB_BY_PATH: Record<string, string> = {
  '/inbox': 'inbox',
  '/dashboard': 'dashboard',
  '/vault': 'vault',
  '/contacts': 'contacts',
  '/admin/usuarios': 'admin_users',
  '/admin/tipos': 'admin_types',
  '/admin/respostas-rapidas': 'admin_quick_replies',
  '/painel': 'painel',
};

const menuItems = [
  { id: 'inbox', label: 'Inbox', icon: Icons.Inbox, path: '/inbox', role: 'ANY' as const },
  { id: 'dashboard', label: 'Métricas', icon: Icons.Chart, path: '/dashboard', role: 'METRICS' as const },
  { id: 'vault', label: 'Cofre Acesso', icon: Icons.Vault, path: '/vault', role: 'ANY' as const },
  { id: 'contacts', label: 'Contatos', icon: Icons.Users, path: '/contacts', role: 'ANY' as const },
  { id: 'painel', label: 'Painel', icon: Icons.QrCode, path: '/painel', role: 'PAINEL' as const },
  { id: 'admin_users', label: 'Equipe', icon: Icons.Users, path: '/admin/usuarios', role: UserRole.ADMIN },
  { id: 'admin_types', label: 'Tipos de Ticket', icon: Icons.Settings, path: '/admin/tipos', role: UserRole.ADMIN },
  { id: 'admin_quick_replies', label: 'Respostas Rápidas', icon: Icons.Settings, path: '/admin/respostas-rapidas', role: UserRole.ADMIN },
];

const Sidebar: React.FC<SidebarProps> = ({ user }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const activeTab = TAB_BY_PATH[pathname] ?? 'inbox';
  const [collapsed, setCollapsed] = useState(false);

  const canSee = (item: (typeof menuItems)[0]) => {
    if (item.role === 'ANY') return true;
    if (item.role === 'PAINEL') return AuthService.canAccessPainel();
    if (item.role === 'METRICS') return user.role === UserRole.SUPERVISOR || user.role === UserRole.ADMIN;
    return user.role === item.role;
  };

  return (
    <aside
      className={`${collapsed ? 'w-20' : 'w-64'} bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 flex flex-col transition-all duration-300 relative z-[60] shadow-xl dark:shadow-2xl shrink-0 border-r border-slate-200 dark:border-slate-800`}
    >
      <div className="p-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-blue-500/20">
            <Icons.Inbox className="w-6 h-6" />
          </div>
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <h1 className="text-slate-800 dark:text-white font-black text-xl tracking-tighter truncate">WillTalk</h1>
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-widest leading-none">Suporte Pro</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="shrink-0 relative z-10 p-2 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/30 transition-colors"
          title={collapsed ? 'Abrir menu' : 'Fechar menu'}
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

      <nav className="flex-1 px-3 space-y-2 mt-4 overflow-x-hidden">
        {menuItems.filter(canSee).map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-2xl transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/20'
                  : 'hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
              } ${collapsed ? 'justify-center' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className={`w-6 h-6 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-500'}`} />
              {!collapsed && <span className="font-bold text-sm truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className={`p-4 border-t border-slate-200 dark:border-slate-800 ${collapsed ? 'flex justify-center' : ''}`}>
        <div className={`flex items-center gap-3 p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700/50 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-10 h-10 rounded-full bg-slate-300 dark:bg-slate-700 shrink-0 overflow-hidden border-2 border-slate-300 dark:border-slate-600 shadow-sm">
            <img src={`https://picsum.photos/seed/${user.id}/40/40`} alt="Avatar" />
          </div>
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate leading-none mb-1">{user.name}</p>
              <p className="text-[10px] font-black text-blue-600 dark:text-blue-500 uppercase tracking-wider">{user.role}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
