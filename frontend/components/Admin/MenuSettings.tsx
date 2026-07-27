import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiPatch } from '../../services/api';
import { ErrorState, LoadingState } from '../ui/PageState';

type MenuItemDefinition = { id: string; label: string; lockedForAdmin?: boolean };
type MenuRole = 'admin' | 'gestor' | 'atendente';
type VisibilityMap = Record<string, Record<MenuRole, boolean>>;
type PermissionAction = 'read' | 'create' | 'update' | 'delete' | 'admin';
type PermissionMap = Record<string, Record<MenuRole, Record<PermissionAction, boolean>>>;

const ROLE_COLUMNS: { key: MenuRole; label: string }[] = [
  { key: 'admin', label: 'Admin' },
  { key: 'gestor', label: 'Gestor' },
  { key: 'atendente', label: 'Atendente' },
];

const PERMISSION_COLUMNS: { key: PermissionAction; label: string; description: string }[] = [
  { key: 'read', label: 'Leitura', description: 'Consultar dados e abrir a tela' },
  { key: 'create', label: 'Criar', description: 'Criar registros ou iniciar ações' },
  { key: 'update', label: 'Editar', description: 'Alterar registros ou configurações' },
  { key: 'delete', label: 'Excluir', description: 'Remover ou revogar registros' },
  { key: 'admin', label: 'Administrar', description: 'Executar ações administrativas sensíveis' },
];

const MenuSettings: React.FC = () => {
  const [items, setItems] = useState<MenuItemDefinition[]>([]);
  const [visibility, setVisibility] = useState<VisibilityMap>({});
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [section, setSection] = useState<'visibility' | 'permissions'>('visibility');
  const [permissionRole, setPermissionRole] = useState<MenuRole>('gestor');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/admin/menu-settings', { method: 'GET' });
      const data = (await res.json()) as { items?: MenuItemDefinition[]; visibility?: VisibilityMap; permissions?: PermissionMap };
      if (res.ok) {
        setItems(data.items || []);
        setVisibility(data.visibility || {});
        setPermissions(data.permissions || {});
        setSavedSnapshot(JSON.stringify({ visibility: data.visibility || {}, permissions: data.permissions || {} }));
      } else {
        setError('Não foi possível carregar as configurações do menu.');
      }
    } catch {
      setError('Não foi possível carregar as configurações do menu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const hasUnsavedChanges = Boolean(savedSnapshot) && JSON.stringify({ visibility, permissions }) !== savedSnapshot;

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  const toggle = (itemId: string, role: MenuRole) => {
    const item = items.find((i) => i.id === itemId);
    if (item?.lockedForAdmin && role === 'admin') return;
    setVisibility((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [role]: !prev[itemId]?.[role] },
    }));
  };

  const togglePermission = (itemId: string, action: PermissionAction) => {
    const item = items.find((entry) => entry.id === itemId);
    if (item?.lockedForAdmin && permissionRole === 'admin') return;
    setPermissions((previous) => ({
      ...previous,
      [itemId]: {
        ...previous[itemId],
        [permissionRole]: {
          ...previous[itemId]?.[permissionRole],
          [action]: !previous[itemId]?.[permissionRole]?.[action],
        },
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSavedAt(null);
    try {
      const data = await apiPatch<{ items: MenuItemDefinition[]; visibility: VisibilityMap; permissions: PermissionMap }>(
        '/api/admin/menu-settings',
        { visibility, permissions },
      );
      setItems(data.items || items);
      setVisibility(data.visibility || visibility);
      setPermissions(data.permissions || permissions);
      setSavedSnapshot(JSON.stringify({ visibility: data.visibility || visibility, permissions: data.permissions || permissions }));
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar as configurações do menu.');
    } finally {
      setSaving(false);
    }
  };

  const selectSection = (next: 'visibility' | 'permissions') => {
    setSection(next);
    window.requestAnimationFrame(() => document.getElementById(`menu-settings-tab-${next}`)?.focus());
  };

  const handleSectionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return selectSection('visibility');
    if (event.key === 'End') return selectSection('permissions');
    return selectSection(section === 'visibility' ? 'permissions' : 'visibility');
  };

  const selectPermissionRole = (next: MenuRole) => {
    setPermissionRole(next);
    window.requestAnimationFrame(() => document.getElementById(`menu-settings-role-${next}`)?.focus());
  };

  const handlePermissionRoleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = ROLE_COLUMNS.findIndex((role) => role.key === permissionRole);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ROLE_COLUMNS.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + ROLE_COLUMNS.length) % ROLE_COLUMNS.length;
    selectPermissionRole(ROLE_COLUMNS[next].key);
  };

  return (
    <main className="mavo-page">
      <div className="mavo-page-content">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Menu do painel</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            Defina separadamente o que cada perfil vê e o que pode executar. Permissões são avaliadas pelas APIs no servidor; esconder um item nunca substitui autorização.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          className="mavo-button-primary"
        >
          {saving ? 'Salvando alterações...' : hasUnsavedChanges ? 'Salvar alterações' : 'Alterações salvas'}
        </button>
      </div>

      {hasUnsavedChanges && !error && (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          Você possui alterações não salvas. Salve antes de sair desta página.
        </div>
      )}

      {error && <ErrorState className="mb-4" description={error} action={<button type="button" onClick={() => void fetchSettings()} disabled={loading || saving} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Tentar novamente</button>} />}
      {savedAt && !error && (
        <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          Configurações salvas agora.
        </div>
      )}

      {loading ? (
        <LoadingState title="Carregando configurações de acesso…" />
      ) : (
        <>
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Configurações de acesso">
          <button id="menu-settings-tab-visibility" type="button" role="tab" tabIndex={section === 'visibility' ? 0 : -1} aria-selected={section === 'visibility'} aria-controls="menu-settings-panel-visibility" onClick={() => selectSection('visibility')} onKeyDown={handleSectionKeyDown} className={section === 'visibility' ? 'mavo-button-primary min-h-0 px-4 py-2 text-sm' : 'mavo-button-secondary min-h-0 px-4 py-2 text-sm'}>Visibilidade no menu</button>
          <button id="menu-settings-tab-permissions" type="button" role="tab" tabIndex={section === 'permissions' ? 0 : -1} aria-selected={section === 'permissions'} aria-controls="menu-settings-panel-permissions" onClick={() => selectSection('permissions')} onKeyDown={handleSectionKeyDown} className={section === 'permissions' ? 'mavo-button-primary min-h-0 px-4 py-2 text-sm' : 'mavo-button-secondary min-h-0 px-4 py-2 text-sm'}>Permissões de backend</button>
        </div>
        {section === 'visibility' ? (
        <div id="menu-settings-panel-visibility" aria-labelledby="menu-settings-tab-visibility" tabIndex={0} className="mavo-card overflow-x-auto" role="tabpanel">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">Item do menu</th>
                {ROLE_COLUMNS.map((col) => (
                  <th key={col.key} className="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider text-center w-28">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{item.label}</td>
                  {ROLE_COLUMNS.map((col) => {
                    const locked = item.lockedForAdmin && col.key === 'admin';
                    return (
                  <td key={col.key} className="px-4 py-3 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={locked ? true : Boolean(visibility[item.id]?.[col.key])}
                          aria-label={`${locked ? 'Visibilidade fixa' : 'Alternar visibilidade'} de ${item.label} para ${col.label}`}
                          onClick={() => toggle(item.id, col.key)}
                          disabled={locked}
                          title={locked ? 'Este item nunca pode ficar oculto para o admin' : undefined}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${locked || visibility[item.id]?.[col.key] ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'} disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${locked || visibility[item.id]?.[col.key] ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : (
        <section id="menu-settings-panel-permissions" aria-labelledby="menu-settings-tab-permissions" tabIndex={0} className="mavo-card overflow-x-auto" role="tabpanel" aria-label="Matriz de permissões">
          <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-300">As permissões abaixo protegem as rotas e ações mesmo quando alguém tenta chamar a API manualmente.</p>
            <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Perfil da matriz">
              {ROLE_COLUMNS.map((role) => <button key={role.key} id={`menu-settings-role-${role.key}`} type="button" role="tab" tabIndex={permissionRole === role.key ? 0 : -1} aria-selected={permissionRole === role.key} aria-controls="menu-settings-permission-matrix" onClick={() => selectPermissionRole(role.key)} onKeyDown={handlePermissionRoleKeyDown} className={permissionRole === role.key ? 'mavo-button-primary min-h-0 px-3 py-2 text-xs' : 'mavo-button-secondary min-h-0 px-3 py-2 text-xs'}>{role.label}</button>)}
            </div>
          </div>
          <table id="menu-settings-permission-matrix" className="w-full min-w-[760px] text-left">
            <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Recurso</th>{PERMISSION_COLUMNS.map((column) => <th key={column.key} scope="col" title={column.description} className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{column.label}</th>)}</tr></thead>
            <tbody>{items.map((item) => <tr key={item.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/80 dark:hover:bg-slate-800/50"><td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{item.label}</td>{PERMISSION_COLUMNS.map((column) => {
              const locked = item.lockedForAdmin && permissionRole === 'admin';
              const enabled = locked || Boolean(permissions[item.id]?.[permissionRole]?.[column.key]);
              return <td key={column.key} className="px-4 py-3 text-center"><button type="button" role="switch" aria-checked={enabled} aria-label={`${locked ? 'Permissão fixa' : 'Alternar permissão'} ${column.label} de ${item.label} para ${permissionRole}`} title={locked ? 'Administradores sempre mantêm acesso a esta configuração' : column.description} disabled={locked} onClick={() => togglePermission(item.id, column.key)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'} disabled:cursor-not-allowed disabled:opacity-60`}><span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition ${enabled ? 'translate-x-6' : 'translate-x-1'}`} /></button></td>;
            })}</tr>)}</tbody>
          </table>
        </section>
        )}
        </>
      )}
      </div>
    </main>
  );
};

export default MenuSettings;
