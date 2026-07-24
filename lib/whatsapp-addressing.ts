export type DirectMessageKey = {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
};

export function isPhoneUserJid(jid: string | null | undefined): boolean {
  return /@(s\.whatsapp\.net|hosted)$/i.test(String(jid || ""));
}

export function isLidUserJid(jid: string | null | undefined): boolean {
  return /@(lid|hosted\.lid)$/i.test(String(jid || ""));
}

export function isDirectUserJid(jid: string | null | undefined): boolean {
  return isPhoneUserJid(jid) || isLidUserJid(jid);
}

export function whatsappPhoneFromJid(
  jid: string | null | undefined,
): string | null {
  if (!isPhoneUserJid(jid)) return null;
  const digits = String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");
  return digits ? `whatsapp:+${digits}` : null;
}

export async function resolvePhoneJid(
  key: DirectMessageKey,
  getPhoneForLid?: (lid: string) => Promise<string | null>,
): Promise<string | null> {
  const candidates = [
    String(key.remoteJid || ""),
    String(key.remoteJidAlt || ""),
  ].filter(Boolean);
  const phoneJid = candidates.find(isPhoneUserJid);
  if (phoneJid) return phoneJid;

  const lid = candidates.find(isLidUserJid);
  if (!lid || !getPhoneForLid) return null;

  const resolved = await getPhoneForLid(lid);
  return isPhoneUserJid(resolved) ? resolved : null;
}
