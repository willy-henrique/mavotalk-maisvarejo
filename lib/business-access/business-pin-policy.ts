export type PinFailureState = {
  failedAttempts: number;
  lockedUntil: Date | null;
};

/**
 * Transição pura usada dentro da transação que bloqueia a linha do usuário.
 * Uma trava já expirada inicia uma nova janela de tentativas.
 */
export function nextPinFailureState(input: {
  currentFailedAttempts: number;
  currentLockedUntil: Date | null;
  maxAttempts: number;
  lockMinutes: number;
  now?: Date;
}): PinFailureState {
  const now = input.now || new Date();
  if (input.currentLockedUntil && input.currentLockedUntil > now) {
    return {
      failedAttempts: Math.max(0, input.currentFailedAttempts),
      lockedUntil: input.currentLockedUntil,
    };
  }

  const previousAttempts = input.currentLockedUntil
    ? 0
    : Math.max(0, input.currentFailedAttempts);
  const failedAttempts = previousAttempts + 1;
  return {
    failedAttempts,
    lockedUntil:
      failedAttempts >= input.maxAttempts
        ? new Date(now.getTime() + input.lockMinutes * 60_000)
        : null,
  };
}
