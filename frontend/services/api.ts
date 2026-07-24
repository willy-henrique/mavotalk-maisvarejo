/**
 * HTTP client with credentials for cookie-based auth.
 * In dev, use relative URLs so Vite proxy sends requests to the backend.
 */

export const getApiBaseUrl = (): string => {
  if (import.meta.env.DEV) return '';
  const origin =
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_ORIGIN;
  return origin ? origin.replace(/\/$/, '') : '';
};

export const getSocketUrl = (): string => {
  if (import.meta.env.DEV) return window.location.origin;
  const origin =
    import.meta.env.VITE_SOCKET_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_ORIGIN;
  return origin ? origin.replace(/\/$/, '') : window.location.origin;
};

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const base = getApiBaseUrl();
  const url = path.startsWith('http') ? path : `${base}${path}`;
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

async function parseJsonOrThrow(res: Response, path: string): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) {
    if (!res.ok) {
      const backendUnreachable =
        res.status === 0 ||
        res.type === 'error' ||
        res.status === 502 ||
        res.status === 503;
      throw new Error(
        backendUnreachable
          ? 'Backend inacessível. Suba o servidor na raiz (npm run dev) — API na porta 4002.'
          : `Erro ${res.status} em ${path}`
      );
    }
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      res.ok
        ? 'Resposta inválida do servidor.'
        : `Erro ${res.status}: ${text.slice(0, 200)}`
    );
  }
}

function errorMessage(data: unknown, fallback: string): string {
  const error = (data as { error?: unknown })?.error;
  if (typeof error === 'string') return error;
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return String((error as { message: string }).message);
  }
  return fallback;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: 'GET' });
  const data = await parseJsonOrThrow(res, path);
  if (!res.ok) {
    const msg = errorMessage(data, res.statusText);
    throw new Error(msg);
  }
  return data as T;
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await parseJsonOrThrow(res, path);
  if (!res.ok) {
    const msg = errorMessage(data, res.statusText);
    throw new Error(msg);
  }
  return data as T;
}

export async function apiPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await parseJsonOrThrow(res, path);
  if (!res.ok) {
    const msg = errorMessage(data, res.statusText);
    throw new Error(msg);
  }
  return data as T;
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: 'DELETE' });
  const data = await parseJsonOrThrow(res, path);
  if (!res.ok) throw new Error(errorMessage(data, res.statusText));
  return data as T;
}
