import React, { useState } from 'react';
import { apiPost } from '../services/api';
import { Dialog } from './ui/Dialog';

/**
 * Primeira mensagem para um número que ainda não escreveu.
 *
 * A lista de contatos só mostra quem já interagiu, então sem isto a loja só
 * conseguia responder, nunca iniciar. Fica em componente próprio porque o Inbox e a
 * tela de Contatos são os dois lugares onde a operação precisa disso.
 */
const StartConversationDialog: React.FC<{
  onClose: () => void;
  onStarted?: (conversationId: string) => void;
}> = ({ onClose, onStarted }) => {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      setError('Informe o número com DDI e DDD. Ex.: 5562984127954.');
      return;
    }
    if (!message.trim()) {
      setError('Escreva a primeira mensagem.');
      return;
    }
    setError('');
    setSending(true);
    try {
      const result = await apiPost<{ conversation: { id: string } }>('/api/conversations', {
        phone: digits,
        message: message.trim(),
        contactName: name.trim() || undefined,
      });
      onClose();
      if (result?.conversation?.id) onStarted?.(result.conversation.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar a conversa.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      title="Nova conversa"
      description="Envie a primeira mensagem para um número que ainda não escreveu para a loja."
      onClose={() => { if (!sending) onClose(); }}
    >
      <form onSubmit={submit} className="space-y-3 p-6">
        <div>
          <label htmlFor="start-chat-phone" className="mb-1 block text-xs font-bold uppercase text-slate-500">Número do WhatsApp *</label>
          <input
            id="start-chat-phone"
            data-autofocus
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="5562984127954"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <p className="mt-1 text-xs text-slate-500">DDI + DDD + número, somente dígitos. O sistema confirma se o número tem WhatsApp antes de enviar.</p>
        </div>
        <div>
          <label htmlFor="start-chat-name" className="mb-1 block text-xs font-bold uppercase text-slate-500">Nome do contato</label>
          <input
            id="start-chat-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Opcional"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label htmlFor="start-chat-message" className="mb-1 block text-xs font-bold uppercase text-slate-500">Primeira mensagem *</label>
          <textarea
            id="start-chat-message"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
        <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          O atendimento já fica atribuído a você e o bot não envia o menu quando a pessoa responder.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={sending} className="mavo-button-secondary">Cancelar</button>
          <button type="submit" disabled={sending} className="mavo-button-primary">{sending ? 'Enviando…' : 'Iniciar conversa'}</button>
        </div>
      </form>
    </Dialog>
  );
};

export default StartConversationDialog;
