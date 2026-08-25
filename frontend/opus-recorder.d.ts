/**
 * O `opus-recorder` não publica tipos. Declarado aqui só o que este projeto usa,
 * em vez de `any`: assim uma troca de opção errada aparece na compilação, e não
 * no meio de um atendimento.
 */
declare module 'opus-recorder' {
  export interface RecorderConfig {
    encoderPath?: string;
    encoderApplication?: number;
    encoderSampleRate?: number;
    numberOfChannels?: number;
    streamPages?: boolean;
    monitorGain?: number;
    recordingGain?: number;
  }

  export default class Recorder {
    constructor(config?: RecorderConfig);
    static isRecordingSupported(): boolean;
    ondataavailable: ((data: Uint8Array | ArrayBuffer) => void) | null;
    start(): Promise<void>;
    stop(): Promise<void>;
    close(): void;
  }
}
