import React, { useState, useEffect, useCallback, useDeferredValue, useRef } from 'react';
import { User, UserRole, UserStatus } from '../../types';
import { Icons } from '../../constants';
import { apiFetch, apiPatch, apiPost } from '../../services/api';
import { Dialog } from '../ui/Dialog';
import { ErrorState, LoadingState } from '../ui/PageState';
import { Pagination } from '../ui/Pagination';

type BackendUser = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'gestor' | 'atendente';
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastLoginAt: string | null;
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
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : undefined,
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
  const [loadError, setLoadError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [total, setTotal] = useState(0);
  const deferredSearch = useDeferredValue(searchTerm);
  const requestRef = useRef(0);

  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<UserRole>(UserRole.AGENT);

  const fetchUsers = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (deferredSearch.trim()) params.set('q', deferredSearch.trim());
      if (roleFilter) params.set('role', toBackendRole(roleFilter as UserRole));
      if (statusFilter) params.set('status', statusFilter === UserStatus.ATIVO ? 'active' : 'inactive');
      const res = await apiFetch(`/api/admin/users?${params.toString()}`, { method: 'GET' });
      const data = (await res.json()) as { items?: BackendUser[]; total?: number };
      if (request !== requestRef.current) return;
      if (res.ok && Array.isArray(data.items)) {
        setUsers(data.items.map(toFrontendUser));
        setTotal(typeof data.total === 'number' ? data.total : 0);
      } else {
        setLoadError('Não foi possível carregar a equipe. Tente novamente.');
      }
    } catch {
      if (request !== requestRef.current) return;
      setLoadError('Não foi possível carregar a equipe. Verifique a conexão e tente novamente.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [deferredSearch, page, roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const pageSize = 25;

  useEffect(() => {
    setPage(1);
  }, [searchTerm, roleFilter, statusFilter]);

  const toggleUserStatus = async (user: User) => {
    setActionUserId(user.id);
    setSubmitError('');
    setNotice('');
    try {
      await apiPatch(`/api/admin/users/${user.id}`, { isActive: user.status !== UserStatus.ATIVO });
      await fetchUsers();
      setNotice(user.status === UserStatus.ATIVO ? 'Colaborador desativado.' : 'Colaborador reativado.');
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o colaborador.');
    } finally {
      setActionUserId(null);
    }
  };

  const getStatusStyle = (status: UserStatus) => {
    switch (status) {
      case UserStatus.ATIVO:
        return 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300';
      case UserStatus.INATIVO:
        return 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300';
      case UserStatus.PENDENTE:
        return 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300';
      default:
        return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  const openModal = () => {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole(UserRole.AGENT);
    setSubmitError('');
    setShowModal(true);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormPassword('');
    setFormRole(user.role);
    setSubmitError('');
    setNotice('');
    setShowModal(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setShowModal(false);
    setEditingUser(null);
    setSubmitError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    if (!formName.trim() || !formEmail.trim() || (!editingUser && !formPassword.trim())) {
      setSubmitError(editingUser ? 'Preencha nome e e-mail.' : 'Preencha nome, e-mail e senha.');
      return;
    }
    if (formPassword && formPassword.length < 8) {
      setSubmitError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    setSubmitting(true);
    try {
      if (editingUser) {
        await apiPatch(`/api/admin/users/${editingUser.id}`, {
          name: formName.trim(),
          email: formEmail.trim().toLowerCase(),
          ...(formPassword ? { password: formPassword } : {}),
          role: toBackendRole(formRole),
        });
      } else {
        await apiPost('/api/admin/users', {
          name: formName.trim(),
          email: formEmail.trim().toLowerCase(),
          password: formPassword,
          role: toBackendRole(formRole),
        });
      }
      await fetchUsers();
      setNotice(editingUser ? 'Colaborador atualizado.' : 'Colaborador adicionado à equipe.');
      setShowModal(false);
      setEditingUser(null);
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

      {loadError && <ErrorState className="mb-5" description={loadError} action={<button type="button" onClick={() => void fetchUsers()} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}
      {submitError && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{submitError}</div>}
      {notice && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</div>}
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
        <LoadingState title="Carregando colaboradores…" />
      ) : (
        <><div className="mavo-card hidden overflow-x-auto md:block">
          <table className="w-full text-left">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Colaborador</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Função</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Último login</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {users.map((u) => (
                <tr key={u.id} className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-blue-800 bg-blue-950 text-xs font-black text-blue-200" aria-label={`Avatar de ${u.name}`}>{u.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>
                      <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{u.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold border ${getStatusStyle(u.status)}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
                    {u.lastLoginAt ? u.lastLoginAt.toLocaleString('pt-BR') : 'Nunca acessou'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2"><button type="button" onClick={() => openEdit(u)} disabled={actionUserId === u.id} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Editar</button><button type="button" disabled={actionUserId === u.id} onClick={() => void toggleUserStatus(u)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">
                      {actionUserId === u.id ? 'Atualizando…' : u.status === UserStatus.ATIVO ? 'Desativar' : 'Reativar'}
                    </button></div>
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    Nenhum colaborador encontrado com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div><div className="grid gap-3 md:hidden">{users.map((u) => <article key={u.id} className="mavo-card space-y-3 p-4"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-800 bg-blue-950 text-xs font-black text-blue-200" aria-label={`Avatar de ${u.name}`}>{u.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{u.name}</h3><p className="truncate text-xs text-slate-500 dark:text-slate-400">{u.email}</p></div><span className={`shrink-0 rounded border px-2 py-1 text-[10px] font-bold ${getStatusStyle(u.status)}`}>{u.status}</span></div><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="font-semibold text-slate-500">Função</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{u.role}</dd></div><div><dt className="font-semibold text-slate-500">Último login</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{u.lastLoginAt ? u.lastLoginAt.toLocaleString('pt-BR') : 'Nunca acessou'}</dd></div></dl><div className="flex flex-wrap gap-2"><button type="button" onClick={() => openEdit(u)} disabled={actionUserId === u.id} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Editar</button><button type="button" disabled={actionUserId === u.id} onClick={() => void toggleUserStatus(u)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">{actionUserId === u.id ? 'Atualizando…' : u.status === UserStatus.ATIVO ? 'Desativar' : 'Reativar'}</button></div></article>)}</div></>
      )}
      {!loading && <Pagination page={page} pageSize={pageSize} total={total} itemLabel="colaboradores" onPageChange={setPage} />}

      {showModal && (
        <Dialog title={editingUser ? 'Editar colaborador' : 'Novo colaborador'} description={editingUser ? 'A senha é opcional; preencha somente para redefini-la.' : 'O colaborador poderá acessar o Mavo Talk com o e-mail e senha definidos.'} onClose={closeModal}>
            <form onSubmit={handleSubmit} className="space-y-5 p-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label htmlFor="team-user-name" className="mb-2 block text-xs font-bold uppercase text-slate-500">Nome completo</label>
                  <input
                    id="team-user-name"
                    data-autofocus
                    type="text"
                    required
                    minLength={2}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="mavo-field"
                    placeholder="Ex: Roberto Carlos"
                  />
                </div>
                <div>
                  <label htmlFor="team-user-email" className="mb-2 block text-xs font-bold uppercase text-slate-500">E-mail corporativo</label>
                  <input
                    id="team-user-email"
                    type="email"
                    required
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="mavo-field"
                    placeholder="email@empresa.com"
                  />
                </div>
                <div>
                  <label htmlFor="team-user-password" className="mb-2 block text-xs font-bold uppercase text-slate-500">{editingUser ? 'Nova senha (opcional)' : 'Senha'}</label>
                  <input
                    id="team-user-password"
                    type="password"
                    required={!editingUser}
                    minLength={8}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="mavo-field"
                    placeholder={editingUser ? 'Deixe em branco para manter a atual' : 'Mínimo 8 caracteres'}
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="team-user-role" className="mb-2 block text-xs font-bold uppercase text-slate-500">Função</label>
                  <select
                    id="team-user-role"
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="mavo-field appearance-none"
                  >
                    <option value={UserRole.AGENT}>Agente (N1)</option>
                    <option value={UserRole.SUPERVISOR}>Supervisor</option>
                    <option value={UserRole.ADMIN}>Administrador</option>
                  </select>
                </div>
              </div>
              {submitError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                  {submitError}
                </div>
              )}
              <div className="flex gap-3 justify-end pt-4">
                <button type="button" disabled={submitting} onClick={closeModal} className="mavo-button-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={submitting} className="mavo-button-primary">
                  {submitting ? 'Salvando...' : editingUser ? 'Salvar alterações' : 'Adicionar colaborador'}
                </button>
              </div>
            </form>
        </Dialog>
      )}
    </div></main>
  );
};

export default UserManagement;
