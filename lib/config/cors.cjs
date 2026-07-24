function normalizeOrigin(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== raw) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

function splitOrigins(value) {
  return String(value || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
}

function configuredOrigins(environment = process.env) {
  const origins = [
    ...splitOrigins(environment.MAVO_ALLOWED_ORIGINS),
    ...splitOrigins(environment.ALLOWED_ORIGINS),
    ...splitOrigins(environment.FRONTEND_URL),
    ...splitOrigins(environment.MAVO_API_PUBLIC_URL),
    ...splitOrigins(environment.API_PUBLIC_URL),
    ...splitOrigins(environment.TWILIO_WEBHOOK_BASE_URL),
  ];

  const renderHostname = String(
    environment.RENDER_EXTERNAL_HOSTNAME || "",
  ).trim();
  if (renderHostname) {
    origins.push(normalizeOrigin(`https://${renderHostname}`));
  }

  if (environment.NODE_ENV !== "production") {
    origins.push(
      "http://localhost:4001",
      "http://localhost:4002",
      "http://localhost:5173",
    );
  }

  return [...new Set(origins.filter(Boolean))];
}

function firstForwardedValue(value) {
  return String(value || "").split(",")[0].trim().toLowerCase();
}

function isSameRequestOrigin(origin, headers = {}) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const url = new URL(normalized);
  const hosts = [
    firstForwardedValue(headers["x-forwarded-host"]),
    firstForwardedValue(headers.host),
  ].filter(Boolean);
  if (!hosts.includes(url.host.toLowerCase())) return false;

  const forwardedProtocol = firstForwardedValue(headers["x-forwarded-proto"]);
  if (forwardedProtocol && `${forwardedProtocol}:` !== url.protocol) {
    return false;
  }

  return true;
}

function isAllowedRequestOrigin(origin, allowedOrigins, headers = {}) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return (
    allowedOrigins.includes(normalized) ||
    isSameRequestOrigin(normalized, headers)
  );
}

module.exports = {
  configuredOrigins,
  isAllowedRequestOrigin,
  isSameRequestOrigin,
  normalizeOrigin,
};
