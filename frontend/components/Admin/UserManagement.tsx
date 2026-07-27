import React, { useState, useEffect, useCallback } from 'react';
import { User, UserRole, UserStatus } from '../../types';
import { Icons } from '../../constants';
import { apiFetch, apiPatch, apiPost } from '../../services/api';

type BackendUser = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'gestor' | 'atendente';
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

function mapBackendRole(r: string): UserRole {
  switch (r) {
    case 'admin': return UserRole.ADMIN;
    case 'gestor': return UserRole.SUPERVISOR;
    case 'atendente': return UserRole.AGENT;
    default: return UserRole.AGENT;
  }
}

function toFrontendUser(u: BackendUser): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: mapBackendRole(u.role),
    status: u.isActive ? UserStatus.ATIVO : UserStatus.INATIVO,
    isOnline: false,
    permissions: u.role === 'admin' ? ['*'] : u.role === 'gestor' ? ['*'] : ['inbox', 'dashboard', 'vault'],
    lastLoginAt: undefined,
  };
}

function toBackendRole(role: UserRole): 'admin' | 'gestor' | 'atendente' {
  switch (role) {
    case UserRole.ADMIN: return 'admin';
    case UserRole.SUPERVISOR: return 'gestor';
    case UserRole.AGENT: return 'atendente';
    default: return 'atendente';
  }
}

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<UserRole>(UserRole.AGENT);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/users', { method: 'GET' });
      const data = (await res.json()) as { users?: BackendUser[] };
      if (res.ok && Array.isArray(data.users)) {
        setUsers(data.users.map(toFrontendUser));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = users.filter(
    (u) =>
      (u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (!roleFilter || u.role === roleFilter) &&
      (!statusFilter || u.status === statusFilter)
  );

  const toggleUserStatus = async (user: User) => {
    setActionUserId(user.id);
    setSubmitError('');
    try {
      await apiPatch(`/api/admin/users/${user.id}`, { isActive: user.status !== UserStatus.ATIVO });
      await fetchUsers();
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o colaborador.');
    } finally {
      setActionUserId(null);
    }
  };

  const getStatusStyle = (status: UserStatus) => {
    switch (status) {
      case UserStatus.ATIVO:
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case UserStatus.INATIVO:
        return 'bg-rose-100 text-rose-700 border-rose-200';
      case UserStatus.PENDENTE:
        return 'bg-amber-100 text-amber-700 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  const openModal = () => {
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole(UserRole.AGENT);
    setSubmitError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    if (!formName.trim() || !formEmail.trim() || !formPassword.trim()) {
      setSubmitError('Preencha nome, e-mail e senha.');
      return;
    }
    if (formPassword.length < 8) {
      setSubmitError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    setSubmitting(true);
    try {
      await apiPost('/api/admin/users', {
        name: formName.trim(),
        email: formEmail.trim().toLowerCase(),
        password: formPassword,
        role: toBackendRole(formRole),
      });
      await fetchUsers();
      setShowModal(false);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao criar colaborador.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mavo-page"><div className="mavo-page-content">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Equipe</h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400">Gerencie colaboradores, perfis e status de acesso ao Mavo Talk.</p>
        </div>
        <button
          onClick={openModal}
          className="mavo-button-primary"
        >
          <Icons.Users className="w-5 h-5" />
          Adicionar Colaborador
        </button>
      </div>

      {submitError && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{submitError}</div>}
      <div className="mavo-card mb-6 flex flex-col gap-3 p-4 md:flex-row">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mavo-field pl-10"
          />
          <div className="absolute left-3 top-3.5 text-slate-400">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </div>
        </div>
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="mavo-field md:max-w-48"><option value="">Todas as funções</option><option value={UserRole.ADMIN}>Administrador</option><option value={UserRole.SUPERVISOR}>Gestor</option><option value={UserRole.AGENT}>Atendente</option></select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mavo-field md:max-w-44"><option value="">Todos os status</option><option value={UserStatus.ATIVO}>Ativos</option><option value={UserStatus.INATIVO}>Inativos</option></select>
      </div>

      {loading ? (
        <p className="text-slate-500 py-8">Carregando colaboradores...</p>
      ) : (
        <div className="mavo-card overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Colaborador</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Função</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Último Login</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-all">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-blue-800 bg-blue-950 text-xs font-black text-blue-200" aria-label={`Avatar de ${u.name}`}>{u.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>
                      <div>
                        <p className="font-bold text-slate-800 text-sm">{u.name}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-600 uppercase border border-slate-200">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold border ${getStatusStyle(u.status)}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500">
                    {u.lastLoginAt ? (u.lastLoginAt instanceof Date ? u.lastLoginAt.toLocaleDateString() : String(u.lastLoginAt)) : 'Nunca'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button type="button" disabled={actionUserId === u.id} onClick={() => void toggleUserStatus(u)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                      {actionUserId === u.id ? 'Atualizando…' : u.status === UserStatus.ATIVO ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl animate-in zoom-in-95">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-800">Novo Colaborador</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nome Completo</label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Ex: Roberto Carlos"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">E-mail Corporativo</label>
                  <input
                    type="email"
                    required
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="email@empresa.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Senha</label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Mínimo 4 caracteres"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Função</label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                  >
                    <option value={UserRole.AGENT}>Agente (N1)</option>
                    <option value={UserRole.SUPERVISOR}>Supervisor</option>
                    <option value={UserRole.ADMIN}>Administrador</option>
                  </select>
                </div>
              </div>
              {submitError && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm">
                  {submitError}
                </div>
              )}
              <div className="flex gap-3 justify-end pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-6 py-3 font-bold text-slate-500 hover:text-slate-700">
                  Cancelar
                </button>
                <button type="submit" disabled={submitting} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-200 disabled:opacity-50">
                  {submitting ? 'Salvando...' : 'Salvar Colaborador'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div></main>
  );
};

export default UserManagement;
