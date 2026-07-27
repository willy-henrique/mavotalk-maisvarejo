import React, { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../services/api';
import { Dialog } from '../ui/Dialog';
import { EmptyState, ErrorState, LoadingState } from '../ui/PageState';
import { Pagination } from '../ui/Pagination';

type Permission =
  | 'sales.read'
  | 'finance.read'
  | 'inventory.read'
  | 'audit.read'
  | 'access.manage';

type AccessUser = {
  id: string;
  name: string;
  phoneNormalized: string;
  role: 'owner' | 'director' | 'manager' | 'analyst';
  isActive: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  lastAccessAt: string | null;
  permissions: Partial<Record<Permission, boolean>>;
};

const permissionOptions: Array<{ key: Permission; label: string }> = [
  { key: 'sales.read', label: 'Vendas e quantidades' },
  { key: 'finance.read', label: 'Valores financeiros' },
  { key: 'inventory.read', label: 'Estoque' },
  { key: 'audit.read', label: 'Auditoria' },
  { key: 'access.manage', label: 'Gestão de acessos' },
];

const BusinessAccessManagement: React.FC = () => {
  const [items, setItems] = useState<AccessUser[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', role: 'manager', pin: '' });
  const [editingPermissions, setEditingPermissions] = useState<AccessUser | null>(null);
  const [resetPinFor, setResetPinFor] = useState<AccessUser | null>(null);
  const [newPin, setNewPin] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<
    Partial<Record<Permission, boolean>>
  >({});
  const pageSize = 25;
  const deferredSearch = useDeferredValue(search);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items: AccessUser[]; total: number }>(
        `/api/admin/business-access?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(deferredSearch)}&role=${encodeURIComponent(roleFilter)}&status=${encodeURIComponent(statusFilter)}`,
      );
      setItems(data.items);
      setTotal(data.total);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar acessos');
    } finally {
      setLoading(false);
    }
  }, [page, deferredSearch, roleFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, roleFilter, statusFilter]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiPost('/api/admin/business-access', {
        ...form,
        permissions: {},
      });
      setShowForm(false);
      setForm({ name: '', phone: '', role: 'manager', pin: '' });
      setPage(1);
      setNotice('Acesso gerencial cadastrado. O número deverá confirmar o PIN no WhatsApp.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao criar acesso');
    } finally {
      setSaving(false);
    }
  };

  const action = async (path: string, body: unknown = {}, successMessage: string, id?: string) => {
    setError('');
    setNotice('');
    setActionId(id || path);
    try {
      await apiPost(path, body);
      setNotice(successMessage);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operação não concluída');
    } finally {
      setActionId(null);
    }
  };

  const toggle = async (item: AccessUser) => {
    setActionId(item.id);
    setError('');
    setNotice('');
    try {
      await apiPatch(`/api/admin/business-access/${item.id}`, { isActive: !item.isActive });
      setNotice(item.isActive ? 'Acesso desativado e sessões revogadas.' : 'Acesso reativado.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operação não concluída');
    } finally {
      setActionId(null);
    }
  };

  const resetPin = async () => {
    if (!resetPinFor) return;
    if (!/^\d{6,12}$/.test(newPin)) {
      setError('O PIN deve conter de 6 a 12 dígitos.');
      return;
    }
    setSaving(true);
    try {
      await action(`/api/admin/business-access/${resetPinFor.id}/reset-pin`, { pin: newPin }, 'PIN atualizado e sessões revogadas.', resetPinFor.id);
      setResetPinFor(null);
      setNewPin('');
    } finally {
      setSaving(false);
    }
  };

  const openPermissions = (item: AccessUser) => {
    setEditingPermissions(item);
    setPermissionDraft({ ...(item.permissions || {}) });
  };

  const savePermissions = async () => {
    if (!editingPermissions) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiPatch(`/api/admin/business-access/${editingPermissions.id}`, {
        permissions: permissionDraft,
      });
      setEditingPermissions(null);
      setNotice('Permissões atualizadas para o acesso gerencial.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar permissões');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mavo-page"><div className="mavo-page-content">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Acessos gerenciais</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Números autorizados para consultas privadas pelo WhatsApp. Eles não entram na fila de atendimento e toda consulta é auditada.</p>
        </div>
        <button type="button" onClick={() => { setShowForm(true); setError(''); }} className="mavo-button-primary">
          Novo acesso
        </button>
      </div>

      {error && <ErrorState className="mb-5" description={error} action={<button type="button" onClick={() => void load()} disabled={loading || actionId !== null || saving} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}
      {notice && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</div>}
      <div className="mb-5 flex flex-wrap gap-3">
        <label className="min-w-[15rem] flex-1"><span className="sr-only">Buscar acesso gerencial</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" className="mavo-field" /></label>
        <label><span className="sr-only">Filtrar por função</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="mavo-field"><option value="">Todas as funções</option><option value="owner">Proprietário</option><option value="director">Diretor</option><option value="manager">Gestor</option><option value="analyst">Analista</option></select></label>
        <label><span className="sr-only">Filtrar por estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mavo-field"><option value="">Todos os estados</option><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="locked">Bloqueado</option></select></label>
      </div>
      {showForm && (
        <Dialog title="Novo acesso gerencial" description="O PIN é usado como confirmação adicional no WhatsApp e nunca é exibido ou armazenado em texto puro." onClose={() => { if (!saving) setShowForm(false); }}>
        <form onSubmit={create} className="grid gap-4 p-6 sm:grid-cols-2">
          <label className="text-sm font-bold text-slate-700 dark:text-slate-200">Nome<input data-autofocus autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome completo" className="mavo-field mt-1" /></label>
          <label className="text-sm font-bold text-slate-700 dark:text-slate-200">Telefone<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Telefone com DDD" inputMode="tel" className="mavo-field mt-1" /></label>
          <label className="text-sm font-bold text-slate-700 dark:text-slate-200">Função<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mavo-field mt-1">
            <option value="owner">Proprietário</option>
            <option value="director">Diretor</option>
            <option value="manager">Gestor</option>
            <option value="analyst">Analista</option>
          </select></label>
          <label className="text-sm font-bold text-slate-700 dark:text-slate-200">PIN<input required type="password" inputMode="numeric" minLength={6} maxLength={12} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} placeholder="6 a 12 dígitos" className="mavo-field mt-1" /></label>
          <div className="col-span-full flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-700"><button type="button" disabled={saving} onClick={() => setShowForm(false)} className="mavo-button-secondary">Cancelar</button><button disabled={saving} className="mavo-button-primary">{saving ? 'Salvando...' : 'Cadastrar acesso'}</button></div>
        </form></Dialog>
      )}
      {editingPermissions && (
        <Dialog title={`Permissões de ${editingPermissions.name}`} description={`“Herdar” usa a matriz padrão do papel ${editingPermissions.role}.`} onClose={() => { if (!saving) setEditingPermissions(null); }}><section className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Uma negação explícita prevalece sobre o papel padrão.</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {permissionOptions.map((permission) => {
              const current = permissionDraft[permission.key];
              return (
                <label key={permission.key} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {permission.label}
                  <select
                    value={current === undefined ? 'inherit' : String(current)}
                    onChange={(event) => {
                      setPermissionDraft((previous) => {
                        const next = { ...previous };
                        if (event.target.value === 'inherit') {
                          delete next[permission.key];
                        } else {
                          next[permission.key] = event.target.value === 'true';
                        }
                        return next;
                      });
                    }}
                    className="mavo-field mt-1 py-2.5"
                  >
                    <option value="inherit">Herdar do papel</option>
                    <option value="true">Permitir</option>
                    <option value="false">Negar</option>
                  </select>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void savePermissions()}
            className="mavo-button-primary mt-4"
          >
            Salvar permissões
          </button>
        </section></Dialog>
      )}
      {resetPinFor && <Dialog title={`Redefinir PIN de ${resetPinFor.name}`} description="Essa ação encerra as sessões gerenciais ativas desse número." onClose={() => { if (!saving) { setResetPinFor(null); setNewPin(''); } }}><form className="p-6" onSubmit={(event) => { event.preventDefault(); void resetPin(); }}><label className="text-sm font-bold text-slate-700 dark:text-slate-200">Novo PIN<input data-autofocus autoFocus required type="password" inputMode="numeric" minLength={6} maxLength={12} value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))} placeholder="6 a 12 dígitos" className="mavo-field mt-1" /></label><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={saving} onClick={() => { setResetPinFor(null); setNewPin(''); }} className="mavo-button-secondary">Cancelar</button><button disabled={saving} className="mavo-button-primary">{saving ? 'Atualizando...' : 'Atualizar PIN'}</button></div></form></Dialog>}
      {loading ? (
        <LoadingState title="Carregando acessos gerenciais…" />
      ) : items.length === 0 ? (
        <EmptyState title={search || roleFilter || statusFilter ? 'Nenhum acesso encontrado.' : 'Nenhum número gerencial autorizado.'} description={search || roleFilter || statusFilter ? 'Altere a busca ou limpe os filtros para visualizar os acessos cadastrados.' : 'Cadastre um responsável, defina as permissões e entregue o PIN por um canal seguro. O acesso não cria tickets nem consome o SLA de atendimento.'} action={search || roleFilter || statusFilter ? <button type="button" onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); }} className="mavo-button-secondary">Limpar filtros</button> : <button type="button" onClick={() => setShowForm(true)} className="mavo-button-primary">Cadastrar primeiro acesso</button>} />
      ) : (
        <><div className="mavo-card hidden overflow-x-auto p-0 md:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase text-slate-500">
              <tr><th className="p-4">Pessoa</th><th className="p-4">Telefone</th><th className="p-4">Papel</th><th className="p-4">Estado</th><th className="p-4">Último acesso</th><th className="p-4">Ações</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-4 font-bold text-slate-800 dark:text-slate-100">{item.name}</td>
                  <td className="p-4 font-mono text-slate-600 dark:text-slate-300">{item.phoneNormalized}</td>
                  <td className="p-4 capitalize text-slate-600 dark:text-slate-300">{item.role}</td>
                  <td className="p-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.lockedUntil && new Date(item.lockedUntil) > new Date() ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200' : item.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{item.lockedUntil && new Date(item.lockedUntil) > new Date() ? 'Bloqueado' : item.isActive ? 'Ativo' : 'Inativo'}</span></td>
                  <td className="p-4 text-slate-500">{item.lastAccessAt ? new Date(item.lastAccessAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={actionId === item.id} onClick={() => void toggle(item)} className="mavo-button-secondary px-2 py-1 text-xs">{actionId === item.id ? 'Salvando...' : item.isActive ? 'Desativar' : 'Ativar'}</button>
                      <button type="button" disabled={actionId === item.id} onClick={() => void action(`/api/admin/business-access/${item.id}/unlock`, {}, 'Acesso desbloqueado.', item.id)} className="mavo-button-secondary px-2 py-1 text-xs">Desbloquear</button>
                      <button type="button" disabled={actionId === item.id} onClick={() => void action(`/api/admin/business-access/${item.id}/revoke-sessions`, {}, 'Sessões gerenciais revogadas.', item.id)} className="mavo-button-secondary px-2 py-1 text-xs">Revogar sessões</button>
                      <button type="button" disabled={actionId === item.id} onClick={() => { setResetPinFor(item); setNewPin(''); }} className="mavo-button-secondary px-2 py-1 text-xs">Redefinir PIN</button>
                      <button type="button" disabled={actionId === item.id} onClick={() => openPermissions(item)} className="mavo-button-primary px-2 py-1 text-xs">Permissões</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div><div className="grid gap-3 md:hidden">{items.map((item) => <article key={item.id} className="mavo-card space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-bold text-slate-800 dark:text-slate-100">{item.name}</h3><p className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">{item.phoneNormalized}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${item.lockedUntil && new Date(item.lockedUntil) > new Date() ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200' : item.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{item.lockedUntil && new Date(item.lockedUntil) > new Date() ? 'Bloqueado' : item.isActive ? 'Ativo' : 'Inativo'}</span></div><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="font-semibold text-slate-500">Papel</dt><dd className="mt-1 capitalize text-slate-700 dark:text-slate-200">{item.role}</dd></div><div><dt className="font-semibold text-slate-500">Último acesso</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{item.lastAccessAt ? new Date(item.lastAccessAt).toLocaleString('pt-BR') : 'Nunca'}</dd></div></dl><div className="flex flex-wrap gap-2"><button type="button" disabled={actionId === item.id} onClick={() => void toggle(item)} className="mavo-button-secondary min-h-0 px-2 py-1 text-xs">{actionId === item.id ? 'Salvando...' : item.isActive ? 'Desativar' : 'Ativar'}</button><button type="button" disabled={actionId === item.id} onClick={() => void action(`/api/admin/business-access/${item.id}/unlock`, {}, 'Acesso desbloqueado.', item.id)} className="mavo-button-secondary min-h-0 px-2 py-1 text-xs">Desbloquear</button><button type="button" disabled={actionId === item.id} onClick={() => void action(`/api/admin/business-access/${item.id}/revoke-sessions`, {}, 'Sessões gerenciais revogadas.', item.id)} className="mavo-button-secondary min-h-0 px-2 py-1 text-xs">Revogar sessões</button><button type="button" disabled={actionId === item.id} onClick={() => { setResetPinFor(item); setNewPin(''); }} className="mavo-button-secondary min-h-0 px-2 py-1 text-xs">Redefinir PIN</button><button type="button" disabled={actionId === item.id} onClick={() => openPermissions(item)} className="mavo-button-primary min-h-0 px-2 py-1 text-xs">Permissões</button></div></article>)}</div></>
      )}
      {!loading && <Pagination page={page} pageSize={pageSize} total={total} itemLabel="acessos" onPageChange={setPage} />}
    </div></main>
  );
};

export default BusinessAccessManagement;
