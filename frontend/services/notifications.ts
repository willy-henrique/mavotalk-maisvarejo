/**
 * Notificações do sistema para a operação.
 *
 * O navegador só entrega notificação com permissão concedida, e a permissão só é
 * pedida a partir de um gesto do usuário — pedir no carregamento faz o Chrome
 * ignorar o pedido e queima a única chance de perguntar.
 */

const SOUND_PREFERENCE_KEY = 'mavo_notification_sound';

export type NotificationPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationSupport(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as 'default' | 'granted' | 'denied';
}

/** Deve ser chamada dentro de um handler de clique. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (notificationSupport() === 'unsupported') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return notificationSupport();
  }
}

export function soundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SOUND_PREFERENCE_KEY) !== 'off';
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? 'on' : 'off');
}

let audioContext: AudioContext | null = null;

/**
 * Alerta sonoro sintetizado.
 *
 * Um arquivo de áudio seria mais bonito, mas exigiria um asset e uma requisição
 * extra; no balcão o que importa é ser audível. O AudioContext só é criado depois
 * de um gesto do usuário, senão o navegador o cria suspenso e o som nunca sai.
 */
export function playNotificationSound(): void {
  if (!soundEnabled() || typeof window === 'undefined') return;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audioContext) audioContext = new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();

    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.connect(audioContext.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    // Duas notas curtas: um bipe único se confunde com notificação de outro app.
    for (const [offset, frequency] of [[0, 880], [0.16, 1170]] as Array<[number, number]>) {
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      oscillator.connect(gain);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.14);
    }
  } catch {
    // Sem áudio disponível a notificação visual continua valendo.
  }
}

/** Prepara o áudio dentro do gesto do usuário, para o primeiro alerta já sair. */
export function primeNotificationSound(): void {
  if (typeof window === 'undefined') return;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audioContext) audioContext = new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();
  } catch {
    // ignore
  }
}

export type SystemNotificationInput = {
  title: string;
  body: string;
  /** Agrupa notificações da mesma conversa em vez de empilhar uma por mensagem. */
  tag?: string;
  onClick?: () => void;
};

export function showSystemNotification({ title, body, tag, onClick }: SystemNotificationInput): void {
  playNotificationSound();
  if (notificationSupport() !== 'granted') return;
  try {
    const notification = new Notification(title, {
      body,
      tag,
      renotify: Boolean(tag),
      icon: '/notification-icon.svg',
    } as NotificationOptions);
    notification.onclick = () => {
      window.focus();
      notification.close();
      onClick?.();
    };
  } catch {
    // Safari fora de PWA instalado lança aqui; o som já foi emitido.
  }
}
