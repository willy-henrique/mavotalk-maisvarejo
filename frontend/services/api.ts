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

export const getApiUrl = (path: string): string => {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
};

/**
 * Token de sessão para quando o cookie não sobrevive.
 *
 * Painel e API ficam em subdomínios distintos de onrender.com, que está na Public
 * Suffix List — o navegador os trata como sites diferentes e o cookie de sessão é
 * third-party. O Safari do iPhone bloqueia esses cookies por padrão, então no
 * celular o login respondia 200 e todo pedido seguinte voltava 401. O cabeçalho
 * Authorization não depende de cookie de terceiros.
 */
const TOKEN_STORAGE_KEY = 'willtalk_access_token';

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

/**
 * Distingue as duas causas possíveis de um 401, que hoje produzem a mesma tela.
 *
 * Sem token, o navegador descartou o armazenamento ou o login é anterior ao uso de
 * token — casos típicos do iPhone, onde o cookie de sessão é third-party e bloqueado.
 * Com token, ele foi recusado pelo servidor, o que aponta para expiração ou chave
 * trocada. O texto vai para a tela porque não há como ler o log de um celular.
 */
function authFailureHint(): string {
  return getAccessToken()
    ? 'token presente e recusado'
    : 'nenhum token salvo neste navegador — saia e entre novamente';
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = getApiUrl(path);
  const token = getAccessToken();
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401 && typeof window !== 'undefined') {
    // O token expirou ou foi recusado. Avisar aqui é o que leva o operador de volta
    // ao login em vez de deixá-lo tentando enviar e recebendo "Não autenticado".
    window.dispatchEvent(new Event('mavo:session-expired'));
  }
  return response;
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

function errorMessage(data: unknown, fallback: string, status?: number): string {
  const error = (data as { error?: unknown })?.error;
  // O 401 chega ao operador como texto na tela; sem esta pista o suporte não separa
  // "token ausente" de "token recusado", que exigem correções diferentes.
  const suffix = status === 401 ? ` (${authFailureHint()})` : '';
  if (typeof error === 'string') return `${error}${suffix}`;
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
    const msg = errorMessage(data, res.statusText, res.status);
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
    const msg = errorMessage(data, res.statusText, res.status);
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
    const msg = errorMessage(data, res.statusText, res.status);
    throw new Error(msg);
  }
  return data as T;
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: 'DELETE' });
  const data = await parseJsonOrThrow(res, path);
  if (!res.ok) throw new Error(errorMessage(data, res.statusText, res.status));
  return data as T;
}
