import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_RECORDING_MS,
  formatRecordingTime,
  isRecordingSupported,
  shouldWarnAboutLimit,
  type ActiveRecording,
  type AudioRecording,
} from '../services/audioRecorder';
import { createAudioRecording } from '../services/audioRecording';

/**
 * Gravar e mandar áudio pelo atendimento.
 *
 * O passo de ouvir antes de enviar não é enfeite: áudio é a única mídia que o
 * remetente não consegue conferir antes de mandar, e um áudio errado no WhatsApp
 * do cliente não tem desfazer.
 *
 * Enquanto grava ou revisa, cobre a linha do composer com uma barra própria. A
 * alternativa — espremer o campo de texto — deixaria a tela pulando de tamanho
 * a cada gravação.
 */

const TICK_MS = 200;

type Estado = 'idle' | 'starting' | 'recording' | 'preview' | 'sending';

type Props = {
  disabled?: boolean;
  onSend: (file: File, durationMs: number) => Promise<boolean>;
  onError: (message: string) => void;
};

const AudioRecorderButton: React.FC<Props> = ({ disabled, onSend, onError }) => {
  const [suportado] = useState(() => isRecordingSupported());
  const [estado, setEstado] = useState<Estado>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [gravacao, setGravacao] = useState<AudioRecording | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const ativaRef = useRef<ActiveRecording | null>(null);
  const inicioRef = useRef(0);

  const limparPreview = useCallback(() => {
    setPreviewUrl((atual) => {
      if (atual) URL.revokeObjectURL(atual);
      return null;
    });
    setGravacao(null);
  }, []);

  const finalizar = useCallback(async () => {
    const ativa = ativaRef.current;
    if (!ativa) return;
    ativaRef.current = null;
    try {
      const resultado = await ativa.stop();
      setGravacao(resultado);
      setPreviewUrl(URL.createObjectURL(resultado.blob));
      setEstado('preview');
    } catch (reason) {
      setEstado('idle');
      onError(reason instanceof Error ? reason.message : 'Não foi possível finalizar a gravação.');
    }
  }, [onError]);

  // Cronômetro e corte no limite. O limite existe porque o anexo tem teto de
  // 16 MB e porque ninguém revisa um áudio de vinte minutos antes de enviar.
  useEffect(() => {
    if (estado !== 'recording') return;
    const timer = window.setInterval(() => {
      const decorrido = Date.now() - inicioRef.current;
      setElapsed(decorrido);
      if (decorrido >= MAX_RECORDING_MS) void finalizar();
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [estado, finalizar]);

  // Sair da conversa no meio da gravação não pode deixar o microfone aberto.
  useEffect(() => () => {
    ativaRef.current?.cancel();
    ativaRef.current = null;
  }, []);

  const iniciar = async () => {
    if (disabled || estado !== 'idle') return;
    setEstado('starting');
    try {
      const ativa = await createAudioRecording();
      ativaRef.current = ativa;
      inicioRef.current = Date.now();
      setElapsed(0);
      setEstado('recording');
    } catch (reason) {
      setEstado('idle');
      const nome = reason instanceof Error ? reason.name : '';
      if (nome === 'NotAllowedError' || nome === 'SecurityError') {
        onError('O navegador bloqueou o microfone. Libere o acesso no cadeado ao lado do endereço e tente de novo.');
      } else if (nome === 'NotFoundError') {
        onError('Nenhum microfone encontrado neste computador.');
      } else {
        onError('Não foi possível iniciar a gravação.');
      }
    }
  };

  const descartar = () => {
    ativaRef.current?.cancel();
    ativaRef.current = null;
    limparPreview();
    setElapsed(0);
    setEstado('idle');
  };

  const enviar = async () => {
    if (!gravacao) return;
    setEstado('sending');
    const entregue = await onSend(gravacao.file, gravacao.durationMs);
    if (entregue) {
      limparPreview();
      setElapsed(0);
      setEstado('idle');
    } else {
      // Falhou o envio: a gravação continua ali, para tentar de novo sem
      // obrigar o técnico a repetir a explicação inteira.
      setEstado('preview');
    }
  };

  if (!suportado) return null;

  const gravando = estado === 'recording';
  const revisando = estado === 'preview' || estado === 'sending';

  return (
    <>
      <button
        type="button"
        onClick={iniciar}
        disabled={disabled || estado !== 'idle'}
        title="Gravar áudio para o cliente"
        aria-label="Gravar áudio"
        className="shrink-0 flex items-center justify-center w-10 h-11 sm:w-12 sm:h-12 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-500 dark:text-slate-400"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
          <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
        </svg>
      </button>

      {(gravando || revisando || estado === 'starting') && (
        <div className="absolute inset-0 z-20 flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-600 dark:bg-slate-900">
          {estado === 'starting' && (
            <span className="text-sm text-slate-500 dark:text-slate-400">Liberando o microfone…</span>
          )}

          {gravando && (
            <>
              <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" aria-hidden="true" />
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-white" aria-live="off">
                {formatRecordingTime(elapsed)}
              </span>
              {shouldWarnAboutLimit(elapsed) && (
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  perto do limite de {formatRecordingTime(MAX_RECORDING_MS)}
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <button type="button" onClick={descartar} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs">
                  Cancelar
                </button>
                <button type="button" onClick={() => void finalizar()} className="mavo-button-primary min-h-0 px-3 py-2 text-xs">
                  Parar
                </button>
              </span>
            </>
          )}

          {revisando && previewUrl && (
            <>
              {/* Ouvir antes de enviar: no WhatsApp do cliente não tem desfazer. */}
              <audio controls src={previewUrl} className="h-9 min-w-0 flex-1" preload="metadata">
                Seu navegador não suporta áudio.
              </audio>
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={descartar}
                  disabled={estado === 'sending'}
                  className="mavo-button-secondary min-h-0 px-3 py-2 text-xs"
                >
                  Descartar
                </button>
                <button
                  type="button"
                  onClick={() => void enviar()}
                  disabled={estado === 'sending'}
                  className="mavo-button-primary min-h-0 px-3 py-2 text-xs"
                >
                  {estado === 'sending' ? 'Enviando…' : 'Enviar áudio'}
                </button>
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default AudioRecorderButton;
