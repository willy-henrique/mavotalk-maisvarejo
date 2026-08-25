import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, getSocketUrl } from '../services/api';
import {
  notificationSupport,
  primeNotificationSound,
  requestNotificationPermission,
  setSoundEnabled,
  showSystemNotification,
  soundEnabled,
  type NotificationPermissionState,
} from '../services/notifications';

/**
 * Notificações de novas mensagens em qualquer tela do painel.
 *
 * O Inbox já notificava, mas só enquanto estava montado: quem estivesse em
 * Contatos, Dashboard ou Filas não recebia nada, que é justamente quando a pessoa
 * não está olhando as conversas. Este componente mantém a própria conexão para não
 * depender da rota aberta.
 */
/** Teto de um ping de atividade por minuto, por conexão. */
const ACTIVITY_PING_MS = 60_000;

const SystemNotifications: React.FC<{ currentUserId?: string }> = ({ currentUserId }) => {
  const navigate = useNavigate();
  const [permission, setPermission] = useState<NotificationPermissionState>(() => notificationSupport());
  const [sound, setSound] = useState<boolean>(() => soundEnabled());
  const [dismissed, setDismissed] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(getSocketUrl(), {
      path: '/socket.io',
      withCredentials: true,
      auth: { token: getAccessToken() || undefined },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;

    socket.on('message.created', (payload: { conversationId?: string; message?: { direction?: string; content?: string } }) => {
      // Só mensagem recebida vira alerta: notificar o que a própria equipe enviou
      // faria o painel avisar sobre a resposta que o atendente acabou de digitar.
      if (payload?.message?.direction === 'outbound') return;
      const conversationId = payload?.conversationId;
      const preview = String(payload?.message?.content || '').trim();
      showSystemNotification({
        title: 'Mavo Talk — nova mensagem',
        body: preview ? preview.slice(0, 140) : 'Você recebeu uma nova mensagem.',
        tag: conversationId ? `conversation:${conversationId}` : undefined,
        onClick: () => {
          if (conversationId) navigate(`/inbox?conversation=${conversationId}`);
          else navigate('/inbox');
        },
      });
    });

    socket.on(
      'conversation.transferred',
      (payload: { conversationId?: string; toUserId?: string | null; fromUserName?: string; note?: string }) => {
        // O evento vai para a organização inteira, mas o aviso é de quem
        // recebeu: notificar todo mundo transformaria cada transferência em
        // ruído para quem não tem nada a ver com ela.
        if (!currentUserId || payload?.toUserId !== currentUserId) return;
        const conversationId = payload?.conversationId;
        showSystemNotification({
          title: 'Mavo Talk — chamado transferido para você',
          body: `${payload?.fromUserName || 'Um colega'}: ${String(payload?.note || '').slice(0, 120)}`,
          tag: conversationId ? `transfer:${conversationId}` : 'transfer',
          onClick: () => navigate(conversationId ? `/inbox?conversation=${conversationId}` : '/inbox'),
        });
      },
    );

    socket.on('conversation.created', () => {
      showSystemNotification({
        title: 'Mavo Talk — novo atendimento',
        body: 'Um cliente iniciou uma conversa.',
        tag: 'new-conversation',
        onClick: () => navigate('/inbox'),
      });
    });

    // Ping de presença. Este componente é o único socket montado em toda tela do
    // painel, então é daqui que dá para afirmar "esta pessoa está interagindo",
    // e não apenas "deixou uma aba aberta". Um por minuto no máximo: a diferença
    // entre 10s e 60s não muda nenhuma decisão de quem coordena, e o tráfego a
    // mais sairia caro numa instância gratuita.
    let ultimoPing = 0;
    const marcarAtividade = () => {
      if (document.visibilityState === 'hidden') return;
      const agora = Date.now();
      if (agora - ultimoPing < ACTIVITY_PING_MS) return;
      ultimoPing = agora;
      socket.emit('presence:activity');
    };
    const eventos: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown', 'visibilitychange'];
    eventos.forEach((evento) => document.addEventListener(evento, marcarAtividade, { passive: true }));
    socket.on('connect', marcarAtividade);

    return () => {
      eventos.forEach((evento) => document.removeEventListener(evento, marcarAtividade));
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [navigate, currentUserId]);

  const enableNotifications = useCallback(async () => {
    // Precisa acontecer dentro do clique: o navegador ignora pedido automático, e o
    // AudioContext criado fora de um gesto nasce suspenso e nunca toca.
    primeNotificationSound();
    const result = await requestNotificationPermission();
    setPermission(result);
  }, []);

  const toggleSound = useCallback(() => {
    setSound((current) => {
      const next = !current;
      setSoundEnabled(next);
      if (next) primeNotificationSound();
      return next;
    });
  }, []);

  if (dismissed || permission === 'granted') return null;

  const unsupported = permission === 'unsupported';
  const denied = permission === 'denied';

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-900 dark:bg-blue-950/40">
      <div className="min-w-0">
        <p className="font-bold text-blue-900 dark:text-blue-100">
          {unsupported
            ? 'Este navegador não entrega notificações do sistema'
            : denied
              ? 'Notificações bloqueadas neste navegador'
              : 'Ative as notificações de novas mensagens'}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-blue-800/80 dark:text-blue-200/80">
          {unsupported
            ? 'No iPhone, adicione o painel à tela de início para receber notificações. O alerta sonoro continua funcionando.'
            : denied
              ? 'Libere as notificações nas permissões do site para ser avisado sem estar com o painel aberto.'
              : 'Você é avisado de mensagens novas mesmo em outra tela do painel.'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={toggleSound} className="rounded-xl border border-blue-300 px-3 py-2 text-xs font-bold text-blue-900 dark:border-blue-800 dark:text-blue-100">
          {sound ? 'Som ligado' : 'Som desligado'}
        </button>
        {!unsupported && !denied && (
          <button type="button" onClick={() => void enableNotifications()} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">
            Ativar
          </button>
        )}
        <button type="button" onClick={() => setDismissed(true)} className="rounded-xl px-2 py-2 text-xs font-bold text-blue-900/70 dark:text-blue-100/70" aria-label="Dispensar aviso">
          ×
        </button>
      </div>
    </div>
  );
};

export default SystemNotifications;
