export const DEFAULT_ORGANIZATION_ID = process.env.DEFAULT_ORG_ID || "org_willtalk_default";

export function isInsideBusinessHours(now: Date, startTime: string, endTime: string) {
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);

  const current = now.getHours() * 60 + now.getMinutes();
  const start = startHour * 60 + startMin;
  const end = endHour * 60 + endMin;

  return current >= start && current <= end;
}

export function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "").trim();
}

export function buildDemandMenu(options: Array<{ menuOption: number; name: string }>) {
  const lines = options
    .sort((a, b) => a.menuOption - b.menuOption)
    .map((option) => `[ ${option.menuOption} ] - ${option.name}`)
    .join("\n");

  return (
    "Olá, como vai?\n" +
    "Seja bem-vindo (a) ao nosso suporte.\n" +
    "Como posso te ajudar?\n\n" +
    lines +
    "\n\nResponda apenas com o número."
  );
}

