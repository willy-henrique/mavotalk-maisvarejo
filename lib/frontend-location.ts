export function canonicalFrontendLocation(
  pathname: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  if (environment.NODE_ENV !== "production") return null;
  const configured = String(environment.FRONTEND_URL || "")
    .split(",")[0]
    .trim();
  if (!configured) return null;

  try {
    const base = new URL(configured);
    if (!["http:", "https:"].includes(base.protocol)) return null;
    const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return new URL(path, base.origin).toString();
  } catch {
    return null;
  }
}
