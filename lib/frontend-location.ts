export function canonicalFrontendLocation(
  pathname: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = String(
    environment.FRONTEND_URL ||
      (environment.NODE_ENV === "production" ? "" : "http://localhost:5173"),
  )
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
