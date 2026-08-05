import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, apiPatch, apiPost } from '../../services/api';
import { QueuePromotionManager, type QueuePromotion } from './QueuePromotionManager';

type Queue = {
  id: string;
  name: string;
  menuOption: number;
  colorHex: string;
  defaultSlaMins: number;
  isActive: boolean;
  queueType?: Config['queueType'];
};

/** Fila deslocada quando a posição escolhida já pertencia a outra. */
type MenuOptionSwap = { id: string; name: string; menuOption: number };

type Config = {
  queueType: 'custom' | 'offers_promotions' | 'business_hours_location';
  generalConfig: Record<string, any>;
  automationConfig: Record<string, any>;
  version: number;
  updatedAt: string;
  publishedAt?: string | null;
};

type QueueData = {
  draft: Config | null;
  published: Config | null;
  history: Array<{ id: string; action: string; changedBy: string | null; createdAt: string }>;
  content: { promotions?: QueuePromotion[]; location?: Record<string, any>; hours?: any[]; exceptions?: any[] };
};

export type QueueAutomationTab = 'Visão geral' | 'Conteúdo' | 'Mensagens' | 'Prévia' | 'Histórico';

const tabs: Array<{ id: QueueAutomationTab; label: string; hint: string }> = [
  { id: 'Visão geral', label: '1. Visão geral', hint: 'Menu e atendimento' },
  { id: 'Conteúdo', label: '2. Conteúdo', hint: 'Ofertas ou unidade' },
  { id: 'Mensagens', label: '3. Mensagens', hint: 'Resposta automática' },
  { id: 'Prévia', label: '4. Prévia', hint: 'Experiência do cliente' },
  { id: 'Histórico', label: 'Histórico', hint: 'Alterações feitas' },
];

const weekDays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const defaultHours = () => weekDays.map((_, weekday) => ({
  weekday,
  isOpen: weekday !== 0,
  openingTime: weekday === 0 ? '08:00' : '07:00',
  closingTime: weekday === 0 ? '14:00' : '21:00',
  secondOpeningTime: null,
  secondClosingTime: null,
}));

/** O tipo é o que define o comportamento do bot; a posição no menu é livre. */
function typeFor(queue: Queue): Config['queueType'] {
  return queue.queueType || 'custom';
}

function defaultConfig(queue: Queue): Config {
  const queueType = typeFor(queue);
  const common = {
    initialMessage: queueType === 'offers_promotions' ? 'Confira nossas ofertas.' : queueType === 'business_hours_location' ? 'Confira nossos horários e localização.' : 'Olá! Como podemos ajudar?',
    noContentMessage: 'No momento não temos conteúdo ativo.',
    closingMessage: null,
    allowHumanHandoff: true,
    showReturnToMenu: true,
    useAiFallback: false,
    enabled: true,
  };

  return {
    queueType,
    version: 0,
    updatedAt: '',
    generalConfig: {
      name: queue.name,
      description: null,
      menuOption: queue.menuOption,
      defaultSlaMins: queue.defaultSlaMins,
      colorHex: queue.colorHex,
      icon: null,
      isActive: queue.isActive,
      allowReturnToMenu: true,
      createTicketOnHumanHandoff: true,
    },
    automationConfig: queueType === 'offers_promotions'
      ? { ...common, beforeFlyerMessage: null, afterFlyerMessage: null, showValidity: true, maxFlyers: 5, deliveryMode: 'all', orderBy: 'display_order', returnToMenuAfterSend: false }
      : queueType === 'business_hours_location'
        ? { ...common, openMessage: 'Estamos abertos agora e funcionamos hoje até {closingTime}.', closedMessage: 'No momento estamos fechados.', intervalMessage: 'No momento estamos no intervalo. Retornaremos hoje às {nextOpeningTime}.', specialHoursMessage: 'Hoje funcionaremos em horário especial, das {openingTime} às {closingTime}.', showPhone: true, showAddress: true, showReferencePoint: true, showMapsUrl: true, showNextOpening: true }
        : common,
  };
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: () => void; label: string; description?: string }) {
  return <label className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950/40">
    <span><span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{label}</span>{description && <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</span>}</span>
    <button type="button" role="switch" aria-checked={checked} onClick={onChange} className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  </label>;
}

function Field({ label, value, onChange, type = 'text', required = false, hint, min, max }: { label: string; value: any; onChange: (value: string) => void; type?: string; required?: boolean; hint?: string; min?: number; max?: number }) {
  return <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
    {label}
    {hint && <span className="ml-2 normal-case tracking-normal text-slate-400">{hint}</span>}
    <input required={required} type={type} min={min} max={max} value={value ?? ''} onChange={(event) => onChange(event.target.value)} className="mavo-field mt-1 text-sm" />
  </label>;
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-5">
    <p className="text-[11px] font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">{eyebrow}</p>
    <h3 className="mt-1 text-lg font-black text-slate-900 dark:text-white">{title}</h3>
    <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
  </div>;
}

function CustomerPreview({ messages, queue }: { messages: string[]; queue: Queue }) {
  return <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/60">
    <div className="mb-3 flex items-center gap-2 px-1"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: queue.colorHex }} /><div><p className="text-xs font-black text-slate-800 dark:text-slate-100">Visão do cliente</p><p className="text-[11px] text-slate-500">Simulação segura no WhatsApp</p></div></div>
    <div className="min-h-72 rounded-xl bg-[#0b141a] p-3 shadow-inner">
      <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-3 text-xs text-white/70"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 font-black text-white">M</span><span>Mavo · atendimento automático</span></div>
      {messages.length ? messages.map((message, index) => <p key={`${message}-${index}`} className="mb-2 max-w-[92%] rounded-xl rounded-tl-sm bg-white px-3 py-2.5 text-sm leading-5 text-slate-800 shadow-sm">{message}</p>) : <p className="mt-14 text-center text-xs text-white/50">A prévia aparecerá quando você escrever uma mensagem.</p>}
    </div>
    <p className="mt-3 px-1 text-[11px] leading-4 text-slate-500">A publicação é necessária para que essas mensagens cheguem aos clientes.</p>
  </aside>;
}

export function QueueAutomationDrawer({ queue, initialTab = 'Visão geral', onClose, onChanged }: { queue: Queue; initialTab?: QueueAutomationTab; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<QueueAutomationTab>(initialTab);
  const [data, setData] = useState<QueueData | null>(null);
  const [config, setConfig] = useState<Config>(defaultConfig(queue));
  const [location, setLocation] = useState<Record<string, any> | null>(null);
  const [hours, setHours] = useState<any[]>(defaultHours());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionTitle, setExceptionTitle] = useState('');
  const [exceptionClosed, setExceptionClosed] = useState(true);
  const [exceptionStart, setExceptionStart] = useState('08:00');
  const [exceptionEnd, setExceptionEnd] = useState('18:00');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/queues/${queue.id}/configuration`, { method: 'GET' });
      const result = await response.json().catch(() => null) as QueueData | { error?: string } | null;
      // Filas recém-criadas ainda não têm uma versão salva. Nesse caso, o editor
      // abre com um rascunho local para que a primeira publicação seja possível.
      if (response.status === 404) {
        setData({ draft: null, published: null, history: [], content: {} });
        setConfig(defaultConfig(queue));
        setLocation(null);
        setHours(defaultHours());
        setHasUnsavedChanges(false);
        return;
      }
      if (!response.ok || !result || !('content' in result)) {
        throw new Error((result as { error?: string } | null)?.error || 'Não foi possível carregar a configuração.');
      }
      setData(result);
      setConfig(result.draft || result.published || defaultConfig(queue));
      setLocation(result.content.location || null);
      setHasUnsavedChanges(false);
      setHours((result.content.hours || []).length
        ? weekDays.map((_, weekday) => {
          const item = result.content.hours?.find((row: any) => Number(row.weekday) === weekday);
          return item ? { weekday, isOpen: item.is_active !== false, openingTime: item.start_time?.slice(0, 5), closingTime: item.end_time?.slice(0, 5), secondOpeningTime: item.second_start_time?.slice(0, 5) || null, secondClosingTime: item.second_end_time?.slice(0, 5) || null } : defaultHours()[weekday];
        })
        : defaultHours());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar a configuração.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [queue.id]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!hasUnsavedChanges || window.confirm('Você tem alterações não salvas. Fechar mesmo assim?')) onClose();
      }
    };
    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [hasUnsavedChanges, onClose]);

  const general = config.generalConfig;
  const automation = config.automationConfig;
  const queueLabel = config.queueType === 'offers_promotions' ? 'Ofertas e promoções' : config.queueType === 'business_hours_location' ? 'Horários e localização' : 'Automação personalizada';
  const hasDraft = Boolean(data?.draft);
  const publishedVersion = data?.published?.version;
  const isIncomplete = !String(general.name || '').trim() || !Number(general.menuOption) || !Number(general.defaultSlaMins) || !String(automation.initialMessage || '').trim();
  const requestClose = () => { if (!hasUnsavedChanges || window.confirm('Você tem alterações não salvas. Fechar mesmo assim?')) onClose(); };
  const updateGeneral = (key: string, value: any) => { setHasUnsavedChanges(true); setConfig((current) => ({ ...current, generalConfig: { ...current.generalConfig, [key]: value } })); };
  const updateAutomation = (key: string, value: any) => { setHasUnsavedChanges(true); setConfig((current) => ({ ...current, automationConfig: { ...current.automationConfig, [key]: value } })); };
  const setLocationField = (key: string, value: string) => { setHasUnsavedChanges(true); setLocation((current) => ({ ...(current || {}), [key]: value })); };

  const saveDraft = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiPatch<{ configuration: Config; menuOptionSwap: MenuOptionSwap | null }>(`/api/queues/${queue.id}/configuration`, { queueType: config.queueType, generalConfig: config.generalConfig, automationConfig: config.automationConfig });
      setConfig(result.configuration);
      setHasUnsavedChanges(false);
      // Nome, posição no menu, cor, SLA e visibilidade valem na hora — é o que o
      // cliente já vê no menu. Só as mensagens esperam a publicação.
      setNotice(result.menuOptionSwap
        ? `Dados do menu salvos. A fila "${result.menuOptionSwap.name}" assumiu a opção ${result.menuOptionSwap.menuOption}. As mensagens ficaram no rascunho — publique para o cliente recebê-las.`
        : 'Dados do menu salvos e já valendo. As mensagens ficaram no rascunho — publique para o cliente recebê-las.');
      onChanged();
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar o rascunho.'); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiPost<{ configuration?: Config; errors?: Record<string, string> }>(`/api/queues/${queue.id}/configuration?action=publish`);
      if (result.errors && Object.keys(result.errors).length) throw new Error(Object.values(result.errors).join(' '));
      setNotice('Tudo certo: a nova versão já está valendo no bot.');
      onChanged();
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível publicar.'); }
    finally { setBusy(false); }
  };

  const discard = async () => {
    setBusy(true); setError('');
    try {
      await apiPost(`/api/queues/${queue.id}/configuration?action=discard`);
      setNotice('Rascunho descartado. A versão publicada foi mantida.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível descartar.'); }
    finally { setBusy(false); }
  };

  const saveLocation = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiPatch(`/api/queues/${queue.id}/location`, {
        unitName: location?.store_name || location?.unit_name || '', displayName: location?.display_name || null,
        address: location?.address_line || '', number: location?.unit_number || null, complement: location?.complement || null,
        district: location?.district || location?.neighborhood || null, city: location?.city || '', state: location?.state || '',
        postalCode: location?.postal_code || null, referencePoint: location?.reference_point || location?.landmark || null,
        phone: location?.phone || null, whatsapp: location?.whatsapp || null, mapsUrl: location?.maps_url || null,
        latitude: location?.latitude ? Number(location.latitude) : null, longitude: location?.longitude ? Number(location.longitude) : null,
        timezone: location?.timezone || 'America/Sao_Paulo',
      });
      const hoursResponse = await apiFetch(`/api/queues/${queue.id}/location/hours`, { method: 'PUT', body: JSON.stringify(hours) });
      if (!hoursResponse.ok) {
        const body = await hoursResponse.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'Não foi possível salvar os horários.');
      }
      setNotice('Unidade e horários salvos no rascunho de conteúdo. Publique para usar no bot.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar a unidade.'); }
    finally { setBusy(false); }
  };

  const saveException = async () => {
    if (!exceptionDate || !exceptionTitle.trim()) { setError('Informe a data e o motivo da exceção.'); return; }
    if (!exceptionClosed && exceptionStart >= exceptionEnd) { setError('O horário especial precisa terminar depois de começar.'); return; }
    setBusy(true); setError('');
    try {
      await apiPost(`/api/queues/${queue.id}/location/exceptions`, { date: exceptionDate, title: exceptionTitle.trim(), isClosed: exceptionClosed, openingTime: exceptionClosed ? null : exceptionStart, closingTime: exceptionClosed ? null : exceptionEnd });
      setExceptionDate(''); setExceptionTitle(''); setNotice('Exceção de horário salva no conteúdo da fila.'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar a exceção.'); }
    finally { setBusy(false); }
  };


  const preview = useMemo(() => {
    if (config.queueType === 'offers_promotions') return [automation.initialMessage, '🖼️ Flyer da promoção', automation.afterFlyerMessage, automation.closingMessage].filter(Boolean);
    if (config.queueType === 'business_hours_location') return [String(automation.openMessage || '').replace('{closingTime}', '21:00'), location?.address_line ? `📍 ${location.address_line}` : '📍 Endereço da unidade', location?.maps_url ? `🗺️ ${location.maps_url}` : null].filter(Boolean);
    return [automation.initialMessage, automation.noContentMessage].filter(Boolean);
  }, [automation, config.queueType, location]);

  const updateHour = (index: number, field: string, value: any) => { setHasUnsavedChanges(true); setHours((current) => current.map((hour, position) => position === index ? { ...hour, [field]: value } : hour)); };

  return <div className="fixed inset-0 z-[var(--mavo-z-modal)] flex justify-end bg-slate-950/70 p-0 backdrop-blur-sm sm:p-3" role="dialog" aria-modal="true" aria-label={`Configurar ${queue.name}`}>
    <aside className="flex h-full w-full flex-col overflow-hidden rounded-none bg-white text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-white min-[900px]:w-[min(1180px,92vw)] sm:rounded-3xl">
      <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:px-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg font-black text-white shadow-lg" style={{ backgroundColor: queue.colorHex }}>{queue.name.charAt(0)}</span>
            <div className="min-w-0"><p className="text-[11px] font-black uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">Editor de automação</p><h2 className="truncate text-xl font-black">{queue.name}</h2><p className="mt-0.5 text-xs text-slate-500">{queueLabel} · opção {general.menuOption} do menu</p></div>
          </div>
          <button ref={closeButtonRef} type="button" onClick={requestClose} className="mavo-button-secondary min-h-0 shrink-0 px-3 py-2" aria-label="Fechar configuração da fila">Fechar</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 ${data?.published ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}><span className={`h-2 w-2 rounded-full ${data?.published ? 'bg-emerald-500' : 'bg-amber-500'}`} />{data?.published ? `Publicado · versão ${publishedVersion}` : 'Ainda não publicado'}</span>
          {hasDraft && <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">Há um rascunho aguardando publicação</span>}
          {hasUnsavedChanges && <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Alterações não salvas</span>}
          {isIncomplete && <span className="rounded-full bg-rose-50 px-3 py-1.5 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">Configuração incompleta</span>}
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">SLA de {general.defaultSlaMins || 30} min</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-52 shrink-0 border-r border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/30 lg:block">
          <p className="px-3 pb-2 pt-1 text-[11px] font-black uppercase tracking-[.14em] text-slate-400">Configure por etapas</p>
          <div className="space-y-1">{tabs.map((item) => <button type="button" key={item.id} onClick={() => setTab(item.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${tab === item.id ? 'bg-blue-600 text-white shadow-md shadow-blue-950/20' : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800'}`}><span className="block text-sm font-black">{item.label}{item.id === 'Conteúdo' && (data?.content.promotions?.length || data?.content.exceptions?.length) ? ` · ${data?.content.promotions?.length || data?.content.exceptions?.length}` : ''}</span><span className={`mt-0.5 block text-[11px] ${tab === item.id ? 'text-blue-100' : 'text-slate-400'}`}>{item.hint}</span></button>)}</div>
        </nav>
        <div className="flex min-h-0 flex-1 flex-col">
          <nav className="flex shrink-0 overflow-x-auto border-b border-slate-200 px-3 dark:border-slate-700 lg:hidden" aria-label="Etapas da configuração">{tabs.map((item) => <button type="button" key={item.id} onClick={() => setTab(item.id)} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-bold ${tab === item.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>{item.label.replace(/^\d\. /, '')}{item.id === 'Conteúdo' && (data?.content.promotions?.length || data?.content.exceptions?.length) ? ` · ${data?.content.promotions?.length || data?.content.exceptions?.length}` : ''}</button>)}</nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
            {loading ? <div className="space-y-4"><div className="h-8 w-56 rounded skeleton" /><div className="h-52 rounded-2xl skeleton" /></div> : <>
              {error && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
              {notice && <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}

              {tab === 'Visão geral' && <div className="max-w-3xl">
                <SectionTitle eyebrow="Base da fila" title="Como essa opção aparece e atende" description="Estes dados montam o menu do WhatsApp e valem assim que você salvar. As mensagens da automação continuam esperando a publicação." />
                <div className="grid gap-4 sm:grid-cols-2"><Field label="Nome no menu" value={general.name} required onChange={(value) => updateGeneral('name', value)} /><Field label="Descrição curta" value={general.description} onChange={(value) => updateGeneral('description', value || null)} /><Field label="Posição no menu" value={general.menuOption} type="number" min={1} max={99} hint="1 a 99 · vale assim que você salvar" onChange={(value) => updateGeneral('menuOption', Number(value))} /><Field label="SLA da primeira resposta" value={general.defaultSlaMins} type="number" hint="minutos" onChange={(value) => updateGeneral('defaultSlaMins', Number(value))} /><label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Cor de identificação<div className="mt-1 flex items-center gap-3"><input aria-label="Cor da fila" type="color" value={general.colorHex || '#2563eb'} onChange={(event) => updateGeneral('colorHex', event.target.value)} className="h-11 w-14 cursor-pointer rounded-xl border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-950" /><span className="text-sm normal-case tracking-normal text-slate-500">{general.colorHex || '#2563eb'}</span></div></label></div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2"><Toggle label="Exibir esta fila no menu" description="Clientes poderão selecionar essa opção." checked={Boolean(general.isActive)} onChange={() => updateGeneral('isActive', !general.isActive)} /><Toggle label="Permitir voltar ao menu" description="Mostra uma saída simples para o cliente." checked={Boolean(general.allowReturnToMenu)} onChange={() => updateGeneral('allowReturnToMenu', !general.allowReturnToMenu)} /><Toggle label="Criar ticket no atendimento humano" description="Registra a solicitação ao transferir." checked={Boolean(general.createTicketOnHumanHandoff)} onChange={() => updateGeneral('createTicketOnHumanHandoff', !general.createTicketOnHumanHandoff)} /></div>
              </div>}

              {tab === 'Mensagens' && <div className="grid max-w-5xl gap-6 xl:grid-cols-[minmax(0,1fr)_290px]"><div>
                <SectionTitle eyebrow="Resposta automática" title="Escreva como o bot deve conversar" description="Use uma linguagem direta e humana. Você pode salvar, conferir na prévia e só então publicar." />
                <div className="space-y-4"><label className="block text-sm font-bold text-slate-800 dark:text-slate-100">Mensagem de boas-vinda<textarea value={automation.initialMessage || ''} onChange={(event) => updateAutomation('initialMessage', event.target.value)} className="mavo-field mt-2 min-h-28 leading-6" placeholder="Ex.: Olá! Em que posso ajudar?" /></label>
                  <div className="flex flex-wrap gap-2"><button type="button" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300" onClick={() => updateAutomation('initialMessage', config.queueType === 'offers_promotions' ? 'Olá! Veja as ofertas disponíveis hoje.' : config.queueType === 'business_hours_location' ? 'Olá! Consulte nossos horários e endereço.' : 'Olá! Como podemos ajudar você hoje?')}>Usar texto sugerido</button><button type="button" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300" onClick={() => setTab('Prévia')}>Ver no WhatsApp</button></div>
                  <label className="block text-sm font-bold text-slate-800 dark:text-slate-100">Mensagem quando não houver conteúdo<textarea value={automation.noContentMessage || ''} onChange={(event) => updateAutomation('noContentMessage', event.target.value)} className="mavo-field mt-2 min-h-24 leading-6" /></label>
                  {config.queueType === 'business_hours_location' && <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><p className="mb-3 text-sm font-black">Mensagens por situação</p><div className="space-y-3">{[['openMessage', 'Quando estiver aberto'], ['closedMessage', 'Quando estiver fechado'], ['intervalMessage', 'Durante o intervalo'], ['specialHoursMessage', 'Em horário especial']].map(([key, label]) => <label key={key} className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}<textarea value={automation[key] || ''} onChange={(event) => updateAutomation(key, event.target.value)} className="mavo-field mt-1 min-h-20 normal-case tracking-normal" /></label>)}</div></div>}
                  <div className="grid gap-3 sm:grid-cols-2"><Toggle label="Automação ativa" description="Responde automaticamente nesta fila." checked={Boolean(automation.enabled)} onChange={() => updateAutomation('enabled', !automation.enabled)} /><Toggle label="Oferecer atendimento humano" description="Permite transferir a conversa." checked={Boolean(automation.allowHumanHandoff)} onChange={() => updateAutomation('allowHumanHandoff', !automation.allowHumanHandoff)} /><Toggle label="Mostrar retorno ao menu" description="Ajuda o cliente a não se perder." checked={Boolean(automation.showReturnToMenu)} onChange={() => updateAutomation('showReturnToMenu', !automation.showReturnToMenu)} /><Toggle label="Usar IA como alternativa" description="Só quando o bot não entender a mensagem." checked={Boolean(automation.useAiFallback)} onChange={() => updateAutomation('useAiFallback', !automation.useAiFallback)} /></div>
                </div>
              </div><CustomerPreview messages={preview} queue={queue} /></div>}

              {tab === 'Conteúdo' && config.queueType === 'offers_promotions' && <QueuePromotionManager queueId={queue.id} promotions={data?.content.promotions || []} published={Boolean(data?.published)} onChanged={load} />}

              {tab === 'Conteúdo' && config.queueType === 'business_hours_location' && <div className="max-w-5xl">
                <SectionTitle eyebrow="Conteúdo da fila" title="Unidade, endereço e horários" description="O bot usa estas informações para responder onde a loja fica e quando ela está aberta." />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Nome da unidade" value={location?.store_name || location?.unit_name} required onChange={(value) => setLocationField('store_name', value)} /><Field label="Nome exibido" value={location?.display_name} onChange={(value) => setLocationField('display_name', value)} /><Field label="Telefone" value={location?.phone} onChange={(value) => setLocationField('phone', value)} /><Field label="Endereço" value={location?.address_line} required onChange={(value) => setLocationField('address_line', value)} /><Field label="Número" value={location?.unit_number} onChange={(value) => setLocationField('unit_number', value)} /><Field label="Bairro" value={location?.district || location?.neighborhood} onChange={(value) => setLocationField('district', value)} /><Field label="Cidade" value={location?.city} required onChange={(value) => setLocationField('city', value)} /><Field label="Estado" value={location?.state} required onChange={(value) => setLocationField('state', value.toUpperCase())} /><Field label="Link do Google Maps" value={location?.maps_url} onChange={(value) => setLocationField('maps_url', value)} /></div>
                <section className="mt-7"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-sm font-black">Horários de funcionamento</p><p className="mt-1 text-xs text-slate-500">Desative os dias em que a unidade não abre.</p></div><button type="button" onClick={() => setHours((current) => current.map((hour) => ({ ...hour, isOpen: hour.weekday !== 0 })))} className="text-xs font-bold text-blue-600 dark:text-blue-400">Aplicar horário de semana</button></div><div className="mt-3 space-y-2">{hours.map((hour, index) => <div key={hour.weekday} className="grid grid-cols-1 items-center gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(130px,1fr)_110px_110px_auto] dark:border-slate-700"><button type="button" onClick={() => updateHour(index, 'isOpen', !hour.isOpen)} className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${hour.isOpen ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{hour.isOpen ? 'Aberto' : 'Fechado'}</button><input aria-label={`Início em ${weekDays[hour.weekday]}`} type="time" disabled={!hour.isOpen} value={hour.openingTime || ''} onChange={(event) => updateHour(index, 'openingTime', event.target.value)} className="mavo-field py-2" /><input aria-label={`Fim em ${weekDays[hour.weekday]}`} type="time" disabled={!hour.isOpen} value={hour.closingTime || ''} onChange={(event) => updateHour(index, 'closingTime', event.target.value)} className="mavo-field py-2" /><span className="text-sm font-bold text-slate-700 dark:text-slate-200">{weekDays[hour.weekday]}</span></div>)}</div></section>
                <section className="mt-7 rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-black">Exceções e datas especiais</p><p className="mt-1 text-xs text-slate-500">Cadastre feriados, fechamentos e horários especiais.</p></div></div>{data?.content.exceptions?.length ? <div className="mt-4 space-y-2">{data.content.exceptions.map((item: any) => <div key={item.id || item.calendar_date} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950"><span><strong>{new Date(`${item.calendar_date || item.date}T12:00:00`).toLocaleDateString('pt-BR')}</strong> · {item.title || item.note}</span><span className="text-xs font-bold text-slate-500">{item.is_closed ? 'Fechado' : `${String(item.start_time || '').slice(0, 5)}–${String(item.end_time || '').slice(0, 5)}`}</span></div>)}</div> : <p className="mt-4 text-sm text-slate-500">Nenhuma exceção cadastrada.</p>}<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Field label="Data" value={exceptionDate} type="date" onChange={setExceptionDate} /><Field label="Motivo" value={exceptionTitle} onChange={setExceptionTitle} /><label className="flex items-center gap-2 self-end pb-3 text-sm font-bold"><input type="checkbox" checked={exceptionClosed} onChange={(event) => setExceptionClosed(event.target.checked)} /> Fechado</label>{!exceptionClosed && <><Field label="Abre" value={exceptionStart} type="time" onChange={setExceptionStart} /><Field label="Fecha" value={exceptionEnd} type="time" onChange={setExceptionEnd} /></>}<button type="button" onClick={() => void saveException()} disabled={busy} className="mavo-button-secondary self-end">Adicionar exceção</button></div></section>
                <button type="button" onClick={() => void saveLocation()} disabled={busy} className="mavo-button-primary mt-6">{busy ? 'Salvando…' : 'Salvar unidade e horários'}</button>
              </div>}

              {tab === 'Conteúdo' && config.queueType === 'custom' && <div className="max-w-2xl rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700"><p className="text-3xl">✨</p><h3 className="mt-3 text-lg font-black">Esta é uma automação personalizada</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Configure a mensagem, encaminhamento e regras na etapa de Mensagens. Esta fila não precisa de flyers, endereço ou horários.</p><button type="button" onClick={() => setTab('Mensagens')} className="mavo-button-primary mt-5">Configurar mensagens</button></div>}

              {tab === 'Prévia' && <div className="mx-auto max-w-md"><SectionTitle eyebrow="Teste antes de publicar" title="Assim o cliente verá a automação" description="Esta é uma simulação. Nenhuma mensagem será enviada durante o teste." /><CustomerPreview messages={preview} queue={queue} /></div>}

              {tab === 'Histórico' && <div className="max-w-3xl"><SectionTitle eyebrow="Rastreabilidade" title="Alterações recentes" description="Acompanhe quem mudou o conteúdo e quando isso aconteceu." /><div className="space-y-3">{data?.history?.length ? data.history.map((item) => <article key={item.id} className="flex gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500" /><div><p className="font-bold">{item.action}</p><p className="mt-1 text-xs text-slate-500">{item.changedBy || 'Sistema'} · {new Date(item.createdAt).toLocaleString('pt-BR')}</p></div></article>) : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">Nenhuma alteração registrada nesta fila.</p>}</div></div>}
            </>}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900 sm:px-7"><p className="hidden text-xs text-slate-500 sm:block">{hasUnsavedChanges ? 'Há alterações não salvas.' : hasDraft ? 'Rascunho aguardando publicação.' : data?.published?.updatedAt ? `Última publicação: ${new Date(data.published.updatedAt).toLocaleString('pt-BR')}` : 'Salvar aplica os dados do menu. Publicar altera as mensagens que o cliente recebe.'}</p><div className="ml-auto flex flex-wrap justify-end gap-2"><button type="button" onClick={requestClose} disabled={busy} className="mavo-button-secondary">Cancelar</button><button type="button" onClick={() => setTab('Prévia')} disabled={busy} className="mavo-button-secondary">Testar automação</button><button type="button" onClick={() => void saveDraft()} disabled={busy} className="mavo-button-secondary">{busy ? 'Salvando…' : 'Salvar alterações'}</button><button type="button" onClick={() => void publish()} disabled={busy || isIncomplete} className="mavo-button-primary">{busy ? 'Publicando…' : 'Publicar alterações'}</button></div></footer>
        </div>
      </div>
    </aside>
  </div>;
}
