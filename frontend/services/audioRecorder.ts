/**
 * Gravação de áudio do atendente, em ogg/opus.
 *
 * O formato não é preferência: o WhatsApp reproduz nota de voz em ogg/opus, e o
 * Chrome só grava webm nativamente. Quem faz a ponte é o `opus-recorder`, que
 * codifica em WASM dentro do navegador — assim o Render não precisa de ffmpeg,
 * e o plano gratuito, que é a restrição real deste projeto, não paga nada por
 * isso. Ver docs/superpowers/specs/2026-08-25-nova-conversa-por-contato-e-audio-design.md.
 *
 * Aqui ficam só as regras: duração, limite, nome do arquivo. Nada de microfone
 * e nada de WASM — o encoder mora em `audioRecording.ts`. A divisão não é
 * estética: o teste da raiz importa este arquivo, e um `import` de módulo que só
 * existe sob o bundler do Vite quebraria a compilação do projeto inteiro.
 */

/** Teto de duração de uma gravação. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/** A partir de quando avisar que o tempo está acabando. */
const WARN_BEFORE_MS = 30 * 1000;

export function formatRecordingTime(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function remainingRecordingMs(elapsedMs: number): number {
  return Math.max(0, MAX_RECORDING_MS - elapsedMs);
}

export function shouldWarnAboutLimit(elapsedMs: number): boolean {
  return remainingRecordingMs(elapsedMs) <= WARN_BEFORE_MS;
}

export function recordingFileName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const data = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hora = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `audio-${data}-${hora}.ogg`;
}

export const RECORDING_MIME_TYPE = 'audio/ogg';

/**
 * O navegador consegue gravar?
 *
 * `isSecureContext` entra na conta porque o acesso ao microfone exige HTTPS. O
 * Render serve assim; `localhost` é a exceção que o próprio navegador abre.
 * Falhar aqui, antes de mostrar o botão, evita o pior caso: o atendente clicar,
 * falar por um minuto e só então descobrir que nada foi gravado.
 */
export function isRecordingSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!window.isSecureContext) return false;
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export type AudioRecording = {
  blob: Blob;
  durationMs: number;
  file: File;
};

export type ActiveRecording = {
  /** Encerra a captura e devolve o que foi gravado. */
  stop(): Promise<AudioRecording>;
  /** Descarta sem produzir arquivo — usado quando o atendente cancela. */
  cancel(): void;
};
