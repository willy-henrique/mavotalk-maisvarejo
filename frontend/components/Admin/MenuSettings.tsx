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

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/admin/menu-settings', { method: 'GET' });
      const data = (await res.json()) as { items?: MenuItemDefinition[]; visibility?: VisibilityMap };
      if (res.ok) {
        setItems(data.items || []);
        setVisibility(data.visibility || {});
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
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar as configurações do menu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-8 flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-800/95 transition-colors">
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Menu do painel</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
            Escolha quais itens do menu lateral cada perfil enxerga. Itens desmarcados somem do menu, mas as rotas continuam
            protegidas pelo mesmo controle de acesso de sempre.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-sm font-medium text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div className="mb-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          Configurações salvas.
        </div>
      )}

      {loading ? (
        <div className="text-slate-400 py-8">Carregando...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 shadow-sm dark:shadow-none">
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
                        <input
                          type="checkbox"
                          checked={locked ? true : Boolean(visibility[item.id]?.[col.key])}
                          onChange={() => toggle(item.id, col.key)}
                          disabled={locked}
                          title={locked ? 'Este item nunca pode ficar oculto para o admin' : undefined}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                        />
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
  );
};

export default MenuSettings;
