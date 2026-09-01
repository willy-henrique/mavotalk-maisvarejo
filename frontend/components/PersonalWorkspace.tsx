import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/api';

type ItemKind = 'note' | 'task' | 'link';
type WorkspaceItem = {
  id: string; kind: ItemKind; title: string; content: string; url: string | null;
  status: 'open' | 'done'; priority: 'low' | 'normal' | 'high'; dueAt: string | null;
  isPinned: boolean; tags: string[];
};

const emptyForm = { kind: 'note' as ItemKind, title: '', content: '', url: '', priority: 'normal', dueAt: '', tags: '' };

const PersonalWorkspace: React.FC = () => {
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | ItemKind | 'open'>('all');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/personal-workspace');
      const data = await response.json() as { items?: WorkspaceItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar seu espaço.');
      setItems(data.items || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar seu espaço.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'open') return item.kind === 'task' && item.status === 'open';
    return item.kind === filter;
  }), [filter, items]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await apiFetch('/api/personal-workspace', {
        method: 'POST',
        body: JSON.stringify({
          kind: form.kind, title: form.title, content: form.content, url: form.url || null,
          priority: form.priority, dueAt: form.dueAt || null, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      const data = await response.json() as { item?: WorkspaceItem; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error || 'Não foi possível salvar.');
      setItems((current) => [data.item!, ...current]);
      setForm(emptyForm);
      setFormOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const response = await apiFetch('/api/personal-workspace/' + id, { method: 'PATCH', body: JSON.stringify(body) });
    const data = await response.json() as { item?: WorkspaceItem; error?: string };
    if (!response.ok || !data.item) throw new Error(data.error || 'Não foi possível atualizar.');
    setItems((current) => current.map((item) => item.id === id ? data.item! : item));
  };

  const remove = async (id: string) => {
    if (!window.confirm('Excluir este item do seu espaço pessoal?')) return;
    const response = await apiFetch('/api/personal-workspace/' + id, { method: 'DELETE' });
    if (!response.ok) { setError('Não foi possível excluir o item.'); return; }
    setItems((current) => current.filter((item) => item.id !== id));
  };

  return <div className="mavo-page"><div className="mavo-page-content max-w-6xl">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Operação pessoal</p><h1 className="mt-1 text-2xl font-black tracking-tight">Meu espaço</h1><p className="mt-2 text-sm text-slate-500">Organize anotações, tarefas e links do seu trabalho. Só você pode visualizar este conteúdo.</p></div>
      <button type="button" onClick={() => setFormOpen((open) => !open)} className="mavo-button-primary">{formOpen ? 'Fechar' : '+ Adicionar item'}</button>
    </div>

    {formOpen && <form onSubmit={save} className="mavo-card mt-6 grid gap-4 p-5 md:grid-cols-2">
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Tipo</span><select value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as ItemKind }))} className="mavo-field"><option value="note">Anotação</option><option value="task">Tarefa</option><option value="link">Link útil</option></select></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Título</span><input required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="mavo-field" placeholder="Ex.: Conferir retorno do fornecedor" /></label>
      {form.kind === 'link' && <label className="md:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-500">Link</span><input type="url" required value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} className="mavo-field" placeholder="https://..." /></label>}
      <label className="md:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-500">Detalhes</span><textarea value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} className="mavo-field min-h-28" placeholder="Contexto, próximos passos ou observações." /></label>
      {form.kind === 'task' && <><label><span className="mb-1 block text-xs font-bold text-slate-500">Prioridade</span><select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} className="mavo-field"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select></label><label><span className="mb-1 block text-xs font-bold text-slate-500">Prazo</span><input type="datetime-local" value={form.dueAt} onChange={(event) => setForm((current) => ({ ...current, dueAt: event.target.value }))} className="mavo-field" /></label></>}
      <label className="md:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-500">Tags</span><input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} className="mavo-field" placeholder="cliente, financeiro, hoje" /></label>
      <div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={() => setFormOpen(false)} className="mavo-button-secondary">Cancelar</button><button disabled={saving} className="mavo-button-primary">{saving ? 'Salvando…' : 'Salvar item'}</button></div>
    </form>}

    <div className="mt-6 flex flex-wrap gap-2">{([['all', 'Tudo'], ['open', 'Pendentes'], ['note', 'Notas'], ['task', 'Tarefas'], ['link', 'Links']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={filter === value ? 'mavo-button-primary min-h-0 px-3 py-2 text-xs' : 'mavo-button-secondary min-h-0 px-3 py-2 text-xs'}>{label}</button>)}</div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
    {loading ? <div className="mt-6 text-sm text-slate-500">Carregando seu espaço…</div> : visible.length === 0 ? <div className="mavo-card mt-6 p-10 text-center"><p className="text-lg font-black">Seu espaço está livre.</p><p className="mt-2 text-sm text-slate-500">Adicione uma anotação, tarefa ou link útil para começar.</p></div> : <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map((item) => <article key={item.id} className="mavo-card flex min-h-48 flex-col p-5">
      <div className="flex items-start justify-between gap-3"><div><span className="text-[11px] font-black uppercase tracking-wide text-blue-600 dark:text-blue-400">{item.kind === 'note' ? 'Nota' : item.kind === 'task' ? 'Tarefa' : 'Link'}</span><h2 className="mt-1 font-black text-slate-900 dark:text-white">{item.title}</h2></div><div className="flex gap-1"><button type="button" onClick={() => void patch(item.id, { isPinned: !item.isPinned })} title={item.isPinned ? 'Desafixar' : 'Fixar'} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800">{item.isPinned ? '★' : '☆'}</button><button type="button" onClick={() => void remove(item.id)} title="Excluir" className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30">×</button></div></div>
      {item.content && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{item.content}</p>}
      {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 truncate text-sm font-bold text-blue-600 hover:underline dark:text-blue-400">{item.url}</a>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">{item.kind === 'task' && <button type="button" onClick={() => void patch(item.id, { status: item.status === 'done' ? 'open' : 'done' })} className={item.status === 'done' ? 'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}>{item.status === 'done' ? 'Concluída' : 'Pendente'}</button>}{item.dueAt && <span className="text-xs text-slate-500">Prazo: {new Date(item.dueAt).toLocaleDateString('pt-BR')}</span>}{item.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{tag}</span>)}</div>
    </article>)}</div>}
  </div></div>;
};

export default PersonalWorkspace;
