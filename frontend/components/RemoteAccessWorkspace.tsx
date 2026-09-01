import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/api';

type Provider = 'anydesk' | 'teamviewer' | 'other';
type RemoteAccess = {
  id: string; provider: Provider; label: string; address: string; username: string | null;
  location: string | null; responsibleName: string | null; notes: string; tags: string[];
  isActive: boolean; hasSecret: boolean;
};

const blank = { provider: 'anydesk' as Provider, label: '', address: '', username: '', location: '', responsibleName: '', notes: '', tags: '', secret: '' };

const providerLabel: Record<Provider, string> = { anydesk: 'AnyDesk', teamviewer: 'TeamViewer', other: 'Outro' };

const RemoteAccessWorkspace: React.FC = () => {
  const [items, setItems] = useState<RemoteAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(blank);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await apiFetch('/api/remote-accesses');
      const data = await response.json() as { items?: RemoteAccess[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os acessos.');
      setItems(data.items || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os acessos.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => [item.label, item.address, item.location, item.responsibleName, item.provider, ...item.tags].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized)));
  }, [items, query]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const response = await apiFetch('/api/remote-accesses', { method: 'POST', body: JSON.stringify({
        provider: form.provider, label: form.label, address: form.address, username: form.username || null,
        location: form.location || null, responsibleName: form.responsibleName || null, notes: form.notes,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean), secret: form.secret || null, isActive: true,
      }) });
      const data = await response.json() as { item?: RemoteAccess; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error || 'Não foi possível salvar.');
      setItems((current) => [data.item!, ...current]);
      setForm(blank); setFormOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  };

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); } catch { setError('Não foi possível copiar. Selecione o valor manualmente.'); }
  };
  const reveal = async (id: string) => {
    setError('');
    try {
      const response = await apiFetch('/api/remote-accesses/' + id + '/reveal', { method: 'POST' });
      const data = await response.json() as { secret?: string; error?: string };
      if (!response.ok || !data.secret) throw new Error(data.error || 'Não foi possível revelar a senha.');
      setRevealed({ id, value: data.secret });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível revelar a senha.'); }
  };
  const archive = async (item: RemoteAccess) => {
    const response = await apiFetch('/api/remote-accesses/' + item.id, { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) });
    const data = await response.json() as { item?: RemoteAccess; error?: string };
    if (!response.ok || !data.item) { setError(data.error || 'Não foi possível atualizar.'); return; }
    setItems((current) => current.map((currentItem) => currentItem.id === item.id ? data.item! : currentItem));
  };

  return <div className="mavo-page"><div className="mavo-page-content max-w-7xl">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Administração segura</p><h1 className="mt-1 text-2xl font-black tracking-tight">Acessos remotos</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">Centralize IDs de AnyDesk e TeamViewer. Senhas são guardadas cifradas, nunca aparecem na lista e cada revelação é auditada.</p></div><button type="button" onClick={() => setFormOpen((open) => !open)} className="mavo-button-primary">{formOpen ? 'Fechar' : '+ Novo acesso'}</button></div>
    {formOpen && <form onSubmit={create} className="mavo-card mt-6 grid gap-4 p-5 md:grid-cols-2">
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Ferramenta</span><select value={form.provider} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value as Provider }))} className="mavo-field"><option value="anydesk">AnyDesk</option><option value="teamviewer">TeamViewer</option><option value="other">Outro</option></select></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Nome do acesso</span><input required value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} className="mavo-field" placeholder="Ex.: Caixa 03 — Loja Centro" /></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-500">ID / endereço</span><input required value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} className="mavo-field" placeholder="123 456 789" /></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Senha de acesso</span><input type="password" value={form.secret} onChange={(event) => setForm((current) => ({ ...current, secret: event.target.value }))} className="mavo-field" placeholder="Opcional · fica cifrada" autoComplete="new-password" /></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Usuário</span><input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} className="mavo-field" placeholder="Opcional" /></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Unidade / local</span><input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} className="mavo-field" placeholder="Loja, setor ou cidade" /></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Responsável</span><input value={form.responsibleName} onChange={(event) => setForm((current) => ({ ...current, responsibleName: event.target.value }))} className="mavo-field" placeholder="Nome do responsável" /></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Tags</span><input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} className="mavo-field" placeholder="loja, pdv, urgente" /></label>
      <label className="md:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-500">Observações</span><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className="mavo-field min-h-24" placeholder="Horário recomendado, contexto do equipamento ou instruções seguras. Não coloque senha aqui." /></label>
      <div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={() => setFormOpen(false)} className="mavo-button-secondary">Cancelar</button><button disabled={saving} className="mavo-button-primary">{saving ? 'Salvando…' : 'Salvar acesso'}</button></div>
    </form>}
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><label className="relative block w-full max-w-md"><span className="sr-only">Buscar acesso</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="mavo-field" placeholder="Buscar por equipamento, ID, unidade ou tag" /></label><span className="text-xs text-slate-500">{filtered.length} acesso(s)</span></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
    {loading ? <p className="mt-6 text-sm text-slate-500">Carregando acessos…</p> : filtered.length === 0 ? <div className="mavo-card mt-6 p-10 text-center"><p className="text-lg font-black">Nenhum acesso remoto cadastrado.</p><p className="mt-2 text-sm text-slate-500">Cadastre AnyDesk, TeamViewer ou outro acesso da equipe.</p></div> : <div className="mt-6 grid gap-4 lg:grid-cols-2">{filtered.map((item) => <article key={item.id} className={'mavo-card p-5 ' + (item.isActive ? '' : 'opacity-60')}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-[11px] font-black uppercase tracking-wide text-blue-600 dark:text-blue-400">{providerLabel[item.provider]}</span><h2 className="mt-1 text-lg font-black">{item.label}</h2>{item.location && <p className="mt-1 text-sm text-slate-500">{item.location}</p>}</div><span className={item.isActive ? 'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300'}>{item.isActive ? 'Ativo' : 'Arquivado'}</span></div>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">ID / endereço</p><div className="mt-1 flex items-center justify-between gap-3"><code className="min-w-0 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{item.address}</code><button type="button" onClick={() => void copy(item.address)} className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400">Copiar</button></div></div>
      {(item.username || item.responsibleName) && <p className="mt-3 text-sm text-slate-500">{item.username && <span>Usuário: {item.username}</span>}{item.username && item.responsibleName && <span> · </span>}{item.responsibleName && <span>Responsável: {item.responsibleName}</span>}</p>}
      {item.notes && <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.notes}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">{item.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{tag}</span>)}<span className="ml-auto" />{item.hasSecret && <button type="button" onClick={() => void reveal(item.id)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Revelar senha</button>}<button type="button" onClick={() => void archive(item)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">{item.isActive ? 'Arquivar' : 'Reativar'}</button></div>
      {revealed?.id === item.id && <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30"><code className="min-w-0 truncate text-sm font-bold text-amber-900 dark:text-amber-100">{revealed.value}</code><div className="flex shrink-0 gap-2"><button type="button" onClick={() => void copy(revealed.value)} className="text-xs font-bold text-amber-800 underline dark:text-amber-200">Copiar</button><button type="button" onClick={() => setRevealed(null)} className="text-xs font-bold text-amber-800 underline dark:text-amber-200">Ocultar</button></div></div>}
    </article>)}</div>}
  </div></div>;
};

export default RemoteAccessWorkspace;
