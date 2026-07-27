import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiPatch } from '../../services/api';

type MenuItemDefinition = { id: string; label: string; lockedForAdmin?: boolean };
type MenuRole = 'admin' | 'gestor' | 'atendente';
type VisibilityMap = Record<string, Record<MenuRole, boolean>>;

const ROLE_COLUMNS: { key: MenuRole; label: string }[] = [
  { key: 'admin', label: 'Admin' },
  { key: 'gestor', label: 'Gestor' },
  { key: 'atendente', label: 'Atendente' },
];

const MenuSettings: React.FC = () => {
  const [items, setItems] = useState<MenuItemDefinition[]>([]);
  const [visibility, setVisibility] = useState<VisibilityMap>({});
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
      const data = (await res.json()) as { items?: MenuItemDefinition[]; visibility?: VisibilityMap };
      if (res.ok) {
        setItems(data.items || []);
        setVisibility(data.visibility || {});
        setSavedSnapshot(JSON.stringify(data.visibility || {}));
      } else {
        setError('Não foi possível carregar as configurações do menu.');
      }
    } catch (e) {
      console.error(e);
      setError('Não foi possível carregar as configurações do menu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const hasUnsavedChanges = Boolean(savedSnapshot) && JSON.stringify(visibility) !== savedSnapshot;

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

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSavedAt(null);
    try {
      const data = await apiPatch<{ items: MenuItemDefinition[]; visibility: VisibilityMap }>(
        '/api/admin/menu-settings',
        { visibility },
      );
      setItems(data.items || items);
      setVisibility(data.visibility || visibility);
      setSavedSnapshot(JSON.stringify(data.visibility || visibility));
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar as configurações do menu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mavo-page">
      <div className="mavo-page-content">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Menu do painel</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            Controle somente o que cada perfil vê na navegação. A visibilidade não concede acesso: as APIs e rotas continuam protegidas por RBAC no servidor.
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

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          Configurações salvas agora.
        </div>
      )}

      {loading ? (
        <div className="mavo-card p-6 text-sm text-slate-500 dark:text-slate-400">Carregando configurações de visibilidade…</div>
      ) : (
        <div className="mavo-card overflow-x-auto">
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
      )}
      </div>
    </main>
  );
};

export default MenuSettings;
