/**
 * Captura do microfone e codificação em ogg/opus.
 *
 * Separado das regras (`audioRecorder.ts`) porque só roda sob o bundler do
 * frontend: o `?url` é resolução do Vite e o encoder é um worker WASM que
 * precisa ser servido pela mesma origem da página.
 *
 * O formato não é preferência: o WhatsApp reproduz nota de voz em ogg/opus, e o
 * Chrome só grava webm nativamente. Codificar no navegador mantém o Render fora
 * disso — sem ffmpeg, sem CPU a mais no plano gratuito.
 */
import {
  MAX_RECORDING_MS,
  RECORDING_MIME_TYPE,
  recordingFileName,
  type ActiveRecording,
  type AudioRecording,
} from './audioRecorder';

type RecorderInstance = {
  ondataavailable: ((data: Uint8Array | ArrayBuffer) => void) | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  close(): void;
};

/**
 * Começa a gravar. Precisa ser chamada de dentro de um clique: todo navegador
 * exige gesto do usuário, e o Safari devolve um stream mudo, sem erro nenhum,
 * quando isso não acontece.
 */
export async function createAudioRecording(): Promise<ActiveRecording> {
  const [{ default: Recorder }, { default: encoderPath }] = await Promise.all([
    import('opus-recorder'),
    import('opus-recorder/dist/encoderWorker.min.js?url'),
  ]);

  const recorder: RecorderInstance = new Recorder({
    encoderPath,
    // 2048 é o perfil de voz do Opus: otimiza inteligibilidade da fala, não
    // fidelidade musical, que é exatamente o caso de uso aqui.
    encoderApplication: 2048,
    encoderSampleRate: 16000,
    numberOfChannels: 1,
    streamPages: false,
    monitorGain: 0,
    recordingGain: 1,
  });

  const startedAt = Date.now();
  let settled = false;

  const recorded = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (data) => {
      if (settled) return;
      settled = true;
      resolve(new Blob([data as BlobPart], { type: RECORDING_MIME_TYPE }));
    };
    // Se o encoder morrer no meio, é melhor falhar alto do que deixar o botão
    // girando para sempre.
    window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('A gravação não pôde ser finalizada.'));
      }
    }, MAX_RECORDING_MS + 30_000);
  });

  await recorder.start();

  return {
    async stop() {
      const durationMs = Date.now() - startedAt;
      await recorder.stop();
      const blob = await recorded;
      recorder.close();
      return {
        blob,
        durationMs,
        file: new File([blob], recordingFileName(), { type: RECORDING_MIME_TYPE }),
      };
    },
    cancel() {
      settled = true;
      recorder.ondataavailable = null;
      void recorder.stop().catch(() => undefined);
      recorder.close();
    },
  };
}
