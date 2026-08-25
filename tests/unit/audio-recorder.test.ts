import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RECORDING_MS,
  formatRecordingTime,
  recordingFileName,
  remainingRecordingMs,
  shouldWarnAboutLimit,
} from "../../frontend/services/audioRecorder";

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;

// ---------------------------------------------------------------------------
// Cronômetro
// ---------------------------------------------------------------------------

test("o tempo aparece como minutos e segundos, com dois dígitos", () => {
  assert.equal(formatRecordingTime(0), "0:00");
  assert.equal(formatRecordingTime(7 * SEGUNDO), "0:07");
  assert.equal(formatRecordingTime(65 * SEGUNDO), "1:05");
  assert.equal(formatRecordingTime(10 * MINUTO), "10:00");
});

test("milissegundos não aparecem como segundo a mais antes da hora", () => {
  // 1999ms ainda é o primeiro segundo: arredondar para cima faria o cronômetro
  // pular na frente de quem está falando.
  assert.equal(formatRecordingTime(1_999), "0:01");
});

test("tempo negativo não vira texto quebrado", () => {
  assert.equal(formatRecordingTime(-5_000), "0:00");
});

// ---------------------------------------------------------------------------
// Limite de duração
// ---------------------------------------------------------------------------

test("o que falta para o limite nunca fica negativo", () => {
  assert.equal(remainingRecordingMs(0), MAX_RECORDING_MS);
  assert.equal(remainingRecordingMs(MAX_RECORDING_MS + 10 * SEGUNDO), 0);
});

test("avisa antes de cortar, não no momento do corte", () => {
  // Ser interrompido no meio de uma explicação sem aviso obrigaria o técnico a
  // gravar tudo de novo.
  assert.equal(shouldWarnAboutLimit(MAX_RECORDING_MS - 60 * SEGUNDO), false);
  assert.equal(shouldWarnAboutLimit(MAX_RECORDING_MS - 20 * SEGUNDO), true);
  assert.equal(shouldWarnAboutLimit(MAX_RECORDING_MS), true);
});

// ---------------------------------------------------------------------------
// Nome do arquivo
// ---------------------------------------------------------------------------

test("o nome carrega a data e sempre termina em .ogg", () => {
  const nome = recordingFileName(new Date("2026-08-25T14:32:09Z"));

  assert.match(nome, /^audio-2026-08-25-\d{6}\.ogg$/);
});

test("dois arquivos gravados em segundos diferentes não colidem", () => {
  const primeiro = recordingFileName(new Date("2026-08-25T14:32:09Z"));
  const segundo = recordingFileName(new Date("2026-08-25T14:32:10Z"));

  assert.notEqual(primeiro, segundo);
});
