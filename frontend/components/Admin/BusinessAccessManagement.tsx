import React, { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../services/api';

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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', role: 'manager', pin: '' });
  const [editingPermissions, setEditingPermissions] = useState<AccessUser | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<
    Partial<Record<Permission, boolean>>
  >({});
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items: AccessUser[]; total: number }>(
        `/api/admin/business-access?page=${page}&pageSize=${pageSize}`,
      );
      setItems(data.items);
      setTotal(data.total);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar acessos');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiPost('/api/admin/business-access', {
        ...form,
        permissions: {},
      });
      setShowForm(false);
      setForm({ name: '', phone: '', role: 'manager', pin: '' });
      setPage(1);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao criar acesso');
    } finally {
      setSaving(false);
    }
  };

  const action = async (path: string, body: unknown = {}) => {
    setError('');
    try {
      await apiPost(path, body);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operação não concluída');
    }
  };

  const toggle = async (item: AccessUser) => {
    try {
      await apiPatch(`/api/admin/business-access/${item.id}`, { isActive: !item.isActive });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operação não concluída');
    }
  };

  const resetPin = async (item: AccessUser) => {
    const pin = window.prompt(`Novo PIN para ${item.name} (6 a 12 dígitos):`);
    if (!pin) return;
    if (!/^\d{6,12}$/.test(pin)) {
      setError('O PIN deve conter de 6 a 12 dígitos.');
      return;
    }
    await action(`/api/admin/business-access/${item.id}/reset-pin`, { pin });
  };

  const openPermissions = (item: AccessUser) => {
    setEditingPermissions(item);
    setPermissionDraft({ ...(item.permissions || {}) });
  };

  const savePermissions = async () => {
    if (!editingPermissions) return;
    setSaving(true);
    try {
      await apiPatch(`/api/admin/business-access/${editingPermissions.id}`, {
        permissions: permissionDraft,
      });
      setEditingPermissions(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar permissões');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-800/95">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Acessos gerenciais</h1>
          <p className="text-sm text-slate-500 mt-1">Números autorizados para consultas pelo WhatsApp.</p>
        </div>
        <button onClick={() => setShowForm((value) => !value)} className="rounded-lg bg-blue-600 px-4 py-2.5 font-bold text-white">
          {showForm ? 'Cancelar' : 'Novo acesso'}
        </button>
      </div>
      {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>}
      {showForm && (
        <form onSubmit={create} className="mb-6 grid grid-cols-1 md:grid-cols-5 gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome" className="rounded-lg border p-3 dark:bg-slate-950 dark:border-slate-700" />
          <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Telefone com DDD" className="rounded-lg border p-3 dark:bg-slate-950 dark:border-slate-700" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="rounded-lg border p-3 dark:bg-slate-950 dark:border-slate-700">
            <option value="owner">Proprietário</option>
            <option value="director">Diretor</option>
            <option value="manager">Gestor</option>
            <option value="analyst">Analista</option>
          </select>
          <input required type="password" inputMode="numeric" minLength={6} maxLength={12} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} placeholder="PIN (mín. 6)" className="rounded-lg border p-3 dark:bg-slate-950 dark:border-slate-700" />
          <button disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50">{saving ? 'Salvando...' : 'Cadastrar'}</button>
        </form>
      )}
      {editingPermissions && (
        <section className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900 dark:text-slate-100">
                Permissões de {editingPermissions.name}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                “Herdar” usa a matriz padrão do papel {editingPermissions.role}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditingPermissions(null)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold dark:border-slate-700"
            >
              Fechar
            </button>
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
                    className="mt-1 block w-full rounded-lg border p-2.5 dark:border-slate-700 dark:bg-slate-950"
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
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2.5 font-bold text-white disabled:opacity-50"
          >
            Salvar permissões
          </button>
        </section>
      )}
      {loading ? (
        <div className="py-12 text-slate-500">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500">Nenhum número gerencial autorizado.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase text-slate-500">
              <tr><th className="p-4">Pessoa</th><th className="p-4">Telefone</th><th className="p-4">Papel</th><th className="p-4">Estado</th><th className="p-4">Último acesso</th><th className="p-4">Ações</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-4 font-bold text-slate-800 dark:text-slate-100">{item.name}</td>
                  <td className="p-4 font-mono text-slate-600 dark:text-slate-300">{item.phoneNormalized}</td>
                  <td className="p-4">{item.role}</td>
                  <td className="p-4">{item.lockedUntil && new Date(item.lockedUntil) > new Date() ? 'Bloqueado' : item.isActive ? 'Ativo' : 'Inativo'}</td>
                  <td className="p-4 text-slate-500">{item.lastAccessAt ? new Date(item.lastAccessAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => toggle(item)} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-1">{item.isActive ? 'Desativar' : 'Ativar'}</button>
                      <button onClick={() => action(`/api/admin/business-access/${item.id}/unlock`)} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-1">Desbloquear</button>
                      <button onClick={() => action(`/api/admin/business-access/${item.id}/revoke-sessions`)} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-1">Revogar sessões</button>
                      <button onClick={() => resetPin(item)} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-1">Redefinir PIN</button>
                      <button onClick={() => openPermissions(item)} className="rounded bg-blue-100 px-2 py-1 text-blue-700 dark:bg-blue-950 dark:text-blue-200">Permissões</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
          <span>
            Página {page} de {Math.ceil(total / pageSize)} — {total} acessos
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="rounded-lg border px-3 py-2 disabled:opacity-40 dark:border-slate-700"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page * pageSize >= total}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-lg border px-3 py-2 disabled:opacity-40 dark:border-slate-700"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessAccessManagement;
