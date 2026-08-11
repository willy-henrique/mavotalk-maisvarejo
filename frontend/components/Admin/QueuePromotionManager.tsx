import React, { useMemo, useRef, useState } from 'react';
import { apiDelete, apiFetch, apiPatch, apiPost } from '../../services/api';
import { Dialog } from '../ui/Dialog';

export type QueuePromotion = {
  id: string;
  title: string;
  description?: string | null;
  caption?: string | null;
  startsAt: string;
  expiresAt: string;
  active: boolean;
  archived: boolean;
  displayOrder: number;
  media?: Array<{ url: string }>;
};

/** Espelha MAX_FLYERS_PER_PROMOTION da rota de promoções. */
const MAX_FLYERS = 10;

type PromotionForm = Omit<QueuePromotion, 'id' | 'archived' | 'media'>;
type Filter = 'all' | 'active' | 'scheduled' | 'expired' | 'inactive';

/** `datetime-local` trabalha em hora local. Usar toISOString() aqui devolvia UTC, e o
 * onChange interpretava o valor de volta como local — cada abertura do formulário
 * deslocava o horário pelo offset do fuso (3h no Brasil), que é o efeito de "puxar
 * para frente ou para trás" relatado pela operação. */
const toInputDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** Limpar o campo produz string vazia, e `new Date('').toISOString()` lança RangeError. */
const fromInputDate = (value: string, fallback: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

/** Fim do dia da data de início, no fuso do operador. */
const endOfStartDay = (startsAt: string) => {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return startsAt;
  date.setHours(23, 59, 0, 0);
  return date.toISOString();
};
const newForm = (): PromotionForm => {
  const startsAt = new Date();
  return { title: '', description: '', caption: '', startsAt: startsAt.toISOString(), expiresAt: new Date(startsAt.getTime() + 24 * 60 * 60 * 1000).toISOString(), active: true, displayOrder: 0 };
};

function promotionState(promotion: QueuePromotion, now = Date.now()) {
  if (promotion.archived) return { id: 'archived', label: 'Arquivada', tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
  if (!promotion.active) return { id: 'inactive', label: 'Inativa', tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
  if (new Date(promotion.startsAt).getTime() > now) return { id: 'scheduled', label: 'Agendada', tone: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' };
  if (new Date(promotion.expiresAt).getTime() <= now) return { id: 'expired', label: 'Expirada', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' };
  return { id: 'active', label: 'Ativa', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' };
}

function remaining(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Encerrada';
  const hours = Math.ceil(ms / 3_600_000);
  return hours < 24 ? `${hours}h restantes` : `${Math.ceil(hours / 24)} dias restantes`;
}

export function QueuePromotionManager({ queueId, promotions, published, onChanged }: { queueId: string; promotions: QueuePromotion[]; published: boolean; onChanged: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState<PromotionForm>(newForm());
  const [editing, setEditing] = useState<QueuePromotion | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState<{ promotion: QueuePromotion; kind: 'archive' | 'delete' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const stats = useMemo(() => promotions.reduce((all, promotion) => {
    const state = promotionState(promotion).id;
    if (state === 'active') all.active += 1;
    if (state === 'scheduled') all.scheduled += 1;
    if (state === 'expired') all.expired += 1;
    return all;
  }, { active: 0, scheduled: 0, expired: 0 }), [promotions]);
  const filtered = promotions.filter((promotion) => filter === 'all' || promotionState(promotion).id === filter);

  const closeForm = () => { setOpen(false); setEditing(null); setFiles([]); setPreviewUrls([]); setError(''); };
  const openNew = (source?: QueuePromotion) => {
    const seed = source ? { title: `${source.title} (cópia)`, description: source.description || '', caption: source.caption || '', startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), active: source.active, displayOrder: source.displayOrder } : newForm();
    setEditing(null); setForm(seed); setFiles([]); setPreviewUrls((source?.media || []).map((item) => item.url)); setError(''); setOpen(true);
  };
  const openEdit = (promotion: QueuePromotion) => { setEditing(promotion); setForm({ title: promotion.title, description: promotion.description || '', caption: promotion.caption || '', startsAt: promotion.startsAt, expiresAt: promotion.expiresAt, active: promotion.active, displayOrder: promotion.displayOrder }); setPreviewUrls((promotion.media || []).map((item) => item.url)); setFiles([]); setError(''); setOpen(true); };
  const chooseFiles = (incoming: FileList | File[] | null) => {
    const next = Array.from(incoming || []);
    if (!next.length) return;
    const invalid = next.find((item) => !['image/jpeg', 'image/png', 'image/webp'].includes(item.type) || item.size > 8 * 1024 * 1024);
    if (invalid) { setError(`“${invalid.name}”: use JPG, PNG ou WEBP de até 8 MB.`); return; }
    if (files.length + next.length > MAX_FLYERS) { setError(`Máximo de ${MAX_FLYERS} flyers por promoção.`); return; }
    setFiles((current) => [...current, ...next]);
    setPreviewUrls((current) => [...current, ...next.map((item) => URL.createObjectURL(item))]);
    setError('');
  };
  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, position) => position !== index));
    setPreviewUrls((current) => current.filter((_, position) => position !== index));
  };
  const setDuration = (hours: number) => setForm((current) => ({ ...current, expiresAt: new Date(new Date(current.startsAt).getTime() + hours * 3_600_000).toISOString() }));
  const submit = async () => {
    if (!form.title.trim()) { setError('Informe o título da promoção.'); return; }
    if (new Date(form.expiresAt) <= new Date(form.startsAt)) { setError('A data de expiração deve ser posterior ao início.'); return; }
    if (!editing && !files.length) { setError('Selecione ao menos um flyer para continuar.'); return; }
    setBusy(true); setError('');
    const payload = { ...form, title: form.title.trim(), description: form.description?.trim() || null, caption: form.caption?.trim() || null, startsAt: new Date(form.startsAt).toISOString(), expiresAt: new Date(form.expiresAt).toISOString(), handoffEnabled: true, afterSendMessage: null };
    try {
      if (editing) {
        await apiPatch(`/api/queues/${queueId}/promotions/${editing.id}`, payload);
      } else {
        const body = new FormData(); for (const item of files) body.append('file', item); body.append('data', JSON.stringify(payload));
        const response = await apiFetch(`/api/queues/${queueId}/promotions`, { method: 'POST', body });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Não foi possível salvar a promoção.');
      }
      closeForm(); await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a promoção.'); }
    finally { setBusy(false); }
  };
  const confirmAction = async () => {
    if (!confirming) return;
    const { promotion, kind } = confirming;
    setBusy(true);
    try {
      if (kind === 'delete') await apiDelete(`/api/queues/${queueId}/promotions/${promotion.id}`);
      else await apiPost(`/api/queues/${queueId}/promotions/${promotion.id}?action=archive`);
      setConfirming(null);
      await onChanged();
    } catch (reason) {
      setConfirming(null);
      setError(reason instanceof Error ? reason.message : `Não foi possível ${kind === 'delete' ? 'excluir' : 'arquivar'} a promoção.`);
    } finally { setBusy(false); }
  };
  const toggle = async (promotion: QueuePromotion) => { setBusy(true); try { await apiPatch(`/api/queues/${queueId}/promotions/${promotion.id}`, { active: !promotion.active }); await onChanged(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a promoção.'); } finally { setBusy(false); } };

  return <section>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className={`text-[11px] font-black uppercase tracking-[.16em] ${published ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}>{published ? 'Conteúdo publicado' : 'Conteúdo não publicado'}</p><h3 className="mt-1 text-lg font-black">Promoções e flyers</h3><p className="mt-1 text-sm text-slate-500">Organize campanhas sem misturar os dados da fila com as ofertas.</p></div><button type="button" onClick={() => openNew()} className="mavo-button-primary">+ Nova promoção</button></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-4"><Stat label="Ativas" value={stats.active} tone="text-emerald-600" /><Stat label="Agendadas" value={stats.scheduled} tone="text-blue-600" /><Stat label="Expiradas" value={stats.expired} tone="text-amber-600" /><Stat label="Próxima expiração" value={promotions.filter((item) => promotionState(item).id === 'active').sort((a, b) => +new Date(a.expiresAt) - +new Date(b.expiresAt))[0] ? remaining(promotions.filter((item) => promotionState(item).id === 'active').sort((a, b) => +new Date(a.expiresAt) - +new Date(b.expiresAt))[0].expiresAt) : '—'} tone="text-slate-700 dark:text-slate-200" /></div>
    <div className="mt-6 flex overflow-x-auto border-b border-slate-200 dark:border-slate-700">{([{ id: 'all', label: 'Todas' }, { id: 'active', label: 'Ativas' }, { id: 'scheduled', label: 'Agendadas' }, { id: 'expired', label: 'Expiradas' }, { id: 'inactive', label: 'Inativas' }] as Array<{ id: Filter; label: string }>).map((item) => <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-bold ${filter === item.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>{item.label}</button>)}</div>
    {!published && promotions.length > 0 && <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Estas promoções ainda não chegam ao bot. Clique em <span className="underline">Publicar alterações</span> para que o cliente receba os flyers no WhatsApp.</p>}
    {error && !open && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
    <div className="mt-4 space-y-3">{filtered.length ? filtered.map((promotion) => { const current = promotionState(promotion); const state = published || (current.id !== 'active' && current.id !== 'scheduled') ? current : { ...current, label: `${current.label} · não publicada`, tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' }; return <article key={promotion.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700 sm:flex-row"><img src={promotion.media?.[0]?.url || ''} alt="" className="h-24 w-full rounded-xl bg-slate-100 object-cover dark:bg-slate-800 sm:w-32" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-black">{promotion.title}</h4><p className="mt-1 text-xs text-slate-500">{new Date(promotion.startsAt).toLocaleString('pt-BR')} → {new Date(promotion.expiresAt).toLocaleString('pt-BR')} · ordem {promotion.displayOrder}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${state.tone}`}>{state.label}</span></div><p className="mt-2 text-sm text-slate-500">{state.id === 'active' ? remaining(promotion.expiresAt) : promotion.caption || 'Sem legenda configurada.'}{(promotion.media?.length || 0) > 1 && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{promotion.media!.length} flyers</span>}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => openEdit(promotion)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Editar</button><button type="button" onClick={() => openNew(promotion)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">Duplicar</button><button type="button" disabled={busy || promotion.archived} onClick={() => void toggle(promotion)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">{promotion.active ? 'Desativar' : 'Ativar'}</button><button type="button" disabled={busy || promotion.archived} onClick={() => setConfirming({ promotion, kind: 'archive' })} className="min-h-0 rounded-xl px-3 py-2 text-xs font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30">Arquivar</button><button type="button" disabled={busy} onClick={() => setConfirming({ promotion, kind: 'delete' })} className="min-h-0 rounded-xl px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30">Excluir</button></div></div></article>; }) : <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700"><p className="text-lg font-black">Você ainda não possui promoções nesta visão.</p><p className="mt-2 text-sm text-slate-500">Crie uma campanha com flyer e defina quando ela estará disponível.</p><button type="button" onClick={() => openNew()} className="mavo-button-primary mt-5">Adicionar primeira promoção</button></div>}</div>
    {open && <div className="fixed inset-0 z-[calc(var(--mavo-z-modal)+1)] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={editing ? 'Editar promoção' : 'Nova promoção'}><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"><header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-700 dark:bg-slate-900"><div><h3 className="text-xl font-black">{editing ? 'Editar promoção' : 'Nova promoção'}</h3><p className="mt-1 text-sm text-slate-500">A promoção é salva como conteúdo da fila e só chega ao bot após publicação.</p></div><button type="button" onClick={closeForm} className="mavo-button-secondary min-h-0 px-3 py-2" disabled={busy}>Fechar</button></header><div className="grid gap-6 p-6 lg:grid-cols-[1fr_.9fr]"><div className="space-y-6"><fieldset><legend className="text-sm font-black">Informações</legend><div className="mt-3 space-y-3"><Input label="Título" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} /><Textarea label="Descrição interna" value={form.description || ''} onChange={(value) => setForm((current) => ({ ...current, description: value }))} /><Textarea label="Legenda enviada ao cliente" value={form.caption || ''} onChange={(value) => setForm((current) => ({ ...current, caption: value }))} /></div></fieldset><fieldset><legend className="text-sm font-black">Período da promoção</legend><p className="mt-1 text-xs text-slate-500">Defina início e expiração livremente, com data e hora. Os atalhos abaixo apenas preenchem a expiração — depois de usá-los você pode ajustar o horário na mão.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><Input label="Início" type="datetime-local" value={toInputDate(form.startsAt)} onChange={(value) => setForm((current) => ({ ...current, startsAt: fromInputDate(value, current.startsAt) }))} /><Input label="Expiração" type="datetime-local" value={toInputDate(form.expiresAt)} onChange={(value) => setForm((current) => ({ ...current, expiresAt: fromInputDate(value, current.expiresAt) }))} /></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setForm((current) => ({ ...current, expiresAt: endOfStartDay(current.startsAt) }))} className={`rounded-lg px-3 py-2 text-xs font-bold ${form.expiresAt === endOfStartDay(form.startsAt) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Até o fim do dia</button>{[[6, '6 horas'], [12, '12 horas'], [24, '24 horas'], [48, '48 horas'], [168, '7 dias']].map(([hours, label]) => <button key={hours} type="button" onClick={() => setDuration(hours as number)} className={`rounded-lg px-3 py-2 text-xs font-bold ${Math.abs(new Date(form.expiresAt).getTime() - new Date(form.startsAt).getTime() - Number(hours) * 3_600_000) < 60_000 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{label}</button>)}</div><p className="mt-3 text-xs text-slate-500">Disponível de {new Date(form.startsAt).toLocaleString('pt-BR')} até {new Date(form.expiresAt).toLocaleString('pt-BR')}.</p></fieldset><fieldset><legend className="text-sm font-black">Exibição</legend><div className="mt-3 grid gap-3 sm:grid-cols-2"><Input label="Ordem de exibição" type="number" value={String(form.displayOrder)} onChange={(value) => setForm((current) => ({ ...current, displayOrder: Number(value) || 0 }))} /><label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold dark:border-slate-700"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /> Ativa ao iniciar</label></div></fieldset></div><div><p className="text-sm font-black">Flyers</p><p className="mt-1 text-xs text-slate-500">O cliente recebe um flyer por mensagem, nesta ordem. Até {MAX_FLYERS} por promoção.</p><div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFiles(event.dataTransfer.files); }} onClick={() => inputRef.current?.click()} className={`mt-3 cursor-pointer rounded-2xl border-2 border-dashed p-5 text-center transition ${dragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-slate-300 hover:border-blue-400 dark:border-slate-700'}`}><input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { chooseFiles(event.target.files); event.target.value = ''; }} />{previewUrls.length ? <div className="grid grid-cols-3 gap-2">{previewUrls.map((url, index) => <div key={url} className="relative"><img src={url} alt={`Flyer ${index + 1}`} className="h-24 w-full rounded-lg object-cover" /><span className="absolute left-1 top-1 rounded bg-slate-900/80 px-1.5 text-xs font-bold text-white">{index + 1}</span></div>)}</div> : <><p className="text-lg font-black">Arraste os flyers para cá</p><p className="mt-2 text-sm text-slate-500">ou clique para selecionar uma ou mais imagens</p></>}<p className="mt-4 text-xs text-slate-500">JPG, PNG ou WEBP · máximo de 8 MB cada</p></div>{files.length > 0 && <ul className="mt-3 space-y-2">{files.map((item, index) => <li key={`${item.name}-${index}`} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-950"><span className="truncate">{index + 1}. {item.name} · {(item.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" onClick={() => removeFile(index)} className="ml-2 shrink-0 font-bold text-rose-600">Remover</button></li>)}</ul>}{editing && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-950">Os flyers atuais são mantidos. Para trocá-los, exclua a promoção e crie outra.</p>}</div></div>{error && <p role="alert" className="mx-6 mb-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}<footer className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900"><button type="button" onClick={closeForm} disabled={busy} className="mavo-button-secondary">Cancelar</button><button type="button" onClick={() => void submit()} disabled={busy} className="mavo-button-primary">{busy ? 'Salvando…' : editing ? 'Salvar promoção' : 'Adicionar promoção'}</button></footer></div></div>}
    {confirming && <ConfirmDialog state={confirming} busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => void confirmAction()} />}
  </section>;
}

function ConfirmDialog({ state, busy, onCancel, onConfirm }: { state: { promotion: QueuePromotion; kind: 'archive' | 'delete' }; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { promotion, kind } = state;
  const destructive = kind === 'delete';
  const flyers = promotion.media?.length || 0;
  return <Dialog
    title={destructive ? 'Excluir promoção' : 'Arquivar promoção'}
    description={destructive ? 'Esta ação remove a promoção e os flyers definitivamente.' : 'A promoção sai do ar e deixa de ser enviada, mas continua no histórico.'}
    onClose={onCancel}
  >
    <div className="px-6 py-5">
      <div className="flex gap-4 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
        {promotion.media?.[0]?.url && <img src={promotion.media[0].url} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />}
        <div className="min-w-0">
          <p className="truncate font-black text-slate-900 dark:text-white">{promotion.title}</p>
          <p className="mt-1 text-xs text-slate-500">{new Date(promotion.startsAt).toLocaleString('pt-BR')} → {new Date(promotion.expiresAt).toLocaleString('pt-BR')}</p>
          {flyers > 0 && <p className="mt-1 text-xs text-slate-500">{flyers === 1 ? '1 flyer' : `${flyers} flyers`}</p>}
        </div>
      </div>
      <p className={`mt-4 rounded-xl p-3 text-sm font-bold ${destructive ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200'}`}>
        {destructive
          ? `Não é possível desfazer. ${flyers === 1 ? 'A imagem será removida' : 'As imagens serão removidas'} também do armazenamento.`
          : 'Você poderá consultá-la depois pelo filtro Arquivadas.'}
      </p>
    </div>
    <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-700">
      <button type="button" onClick={onCancel} disabled={busy} data-autofocus className="mavo-button-secondary">Cancelar</button>
      <button type="button" onClick={onConfirm} disabled={busy} className={`min-h-0 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-60 ${destructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
        {busy ? 'Aguarde…' : destructive ? 'Excluir definitivamente' : 'Arquivar'}
      </button>
    </footer>
  </Dialog>;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: string }) { return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/40"><p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 truncate text-lg font-black ${tone}`}>{value}</p></div>; }
function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; type?: string; onChange: (value: string) => void }) { return <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mavo-field mt-1 normal-case tracking-normal" /></label>; }
function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} className="mavo-field mt-1 min-h-20 normal-case tracking-normal" /></label>; }
