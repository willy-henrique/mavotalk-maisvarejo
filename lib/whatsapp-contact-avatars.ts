export type WhatsappAvatarTarget = {
  phoneNumber: string;
  jid: string;
};

export type WhatsappAvatarUpdate = {
  phoneNumber: string;
  avatarUrl: string;
};

export type WhatsappAvatarSyncResult = {
  requested: number;
  found: number;
  saved: number;
  unavailable: number;
};

type SyncWhatsappContactAvatarsOptions = {
  targets: WhatsappAvatarTarget[];
  profilePictureUrl: (jid: string) => Promise<string | null | undefined>;
  persist: (updates: WhatsappAvatarUpdate[]) => Promise<number>;
  concurrency?: number;
  timeoutMs?: number;
};

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function uniqueTargets(targets: WhatsappAvatarTarget[]): WhatsappAvatarTarget[] {
  const unique = new Map<string, WhatsappAvatarTarget>();
  for (const target of targets) {
    const phoneNumber = String(target.phoneNumber || "").trim();
    const jid = String(target.jid || "").trim();
    if (!phoneNumber || !jid || unique.has(phoneNumber)) continue;
    unique.set(phoneNumber, { phoneNumber, jid });
  }
  return [...unique.values()];
}

async function lookupWithTimeout(
  lookup: () => Promise<string | null | undefined>,
  timeoutMs: number,
): Promise<string | null | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Consulta fotos do WhatsApp em paralelo controlado. Ausência de foto, privacidade
 * e timeout são resultados normais: nenhum deles deve interromper o restante da
 * agenda ou apagar uma imagem válida que já esteja salva.
 */
export async function syncWhatsappContactAvatars({
  targets,
  profilePictureUrl,
  persist,
  concurrency = 3,
  timeoutMs = 6_000,
}: SyncWhatsappContactAvatarsOptions): Promise<WhatsappAvatarSyncResult> {
  const pending = uniqueTargets(targets);
  const workerCount = Math.min(
    pending.length,
    Math.max(1, Math.min(6, Math.trunc(concurrency) || 1)),
  );
  const lookupTimeoutMs = Math.max(500, Math.min(30_000, timeoutMs));
  const updates: WhatsappAvatarUpdate[] = [];
  let nextIndex = 0;
  let unavailable = 0;

  const worker = async () => {
    while (nextIndex < pending.length) {
      const target = pending[nextIndex++];
      try {
        const avatarUrl = safeHttpsUrl(
          await lookupWithTimeout(
            () => profilePictureUrl(target.jid),
            lookupTimeoutMs,
          ),
        );
        if (avatarUrl) updates.push({ phoneNumber: target.phoneNumber, avatarUrl });
        else unavailable += 1;
      } catch {
        // O WhatsApp rejeita esta consulta quando a foto não existe ou a privacidade
        // do contato não permite acesso. A sincronização dos demais deve continuar.
        unavailable += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  const saved = updates.length ? await persist(updates) : 0;
  return {
    requested: pending.length,
    found: updates.length,
    saved,
    unavailable,
  };
}
