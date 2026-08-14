import { apiFetch, apiGet, apiPost, getAccessToken, setAccessToken } from './api';
import { User, UserRole, UserStatus, AuthState } from '../types';

const AUTH_STORAGE_KEY = 'willtalk_auth_session';

type BackendRole = 'admin' | 'gestor' | 'atendente';

function mapRole(role: BackendRole): UserRole {
  switch (role) {
    case 'admin': return UserRole.ADMIN;
    case 'gestor': return UserRole.SUPERVISOR;
    case 'atendente': return UserRole.AGENT;
    default: return UserRole.AGENT;
  }
}

function permissionsForRole(role: UserRole): string[] {
  if (role === UserRole.ADMIN) return ['*'];
  if (role === UserRole.SUPERVISOR) return ['*'];
  return ['inbox', 'dashboard', 'vault'];
}

export class AuthService {
  private static state: AuthState = {
    user: null,
    accessToken: null,
    isAuthenticated: false,
  };

  static async login(email: string, password: string): Promise<AuthState> {
    // Descarta qualquer resquício antes de autenticar: uma sessão antiga no
    // navegador faz a interface se achar logada enquanto a API responde 401.
    this.clearStoredSession();
    const { token } = await apiPost<{ token?: string }>('/api/auth/login', { email, password });
    // Precisa valer já na chamada seguinte: sem o cookie (bloqueado no celular),
    // é o cabeçalho Authorization que autentica o /api/me logo abaixo.
    setAccessToken(token || null);
    const { user: payload } = await apiGet<{ user: { userId: string; name: string; email: string; role: BackendRole } }>('/api/me');
    if (!payload) throw new Error('Sessão não retornada.');

    const role = mapRole(payload.role);
    const user: User = {
      id: payload.userId,
      name: payload.name || '',
      email: payload.email || '',
      role,
      status: UserStatus.ATIVO,
      isOnline: true,
      permissions: permissionsForRole(role),
    };

    const authData: AuthState = {
      user,
      accessToken: null,
      isAuthenticated: true,
    };
    this.saveSession(authData);
    return authData;
  }

  static async logout(): Promise<void> {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      this.clearStoredSession();
    }
  }

  /** Zera tudo que representa sessão no navegador — estado, localStorage e token. */
  static clearStoredSession(): void {
    this.state = { user: null, accessToken: null, isAuthenticated: false };
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAccessToken(null);
  }

  private static saveSession(data: AuthState) {
    this.state = data;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
  }

  static getSession(): AuthState | null {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        this.state = JSON.parse(stored);
        return this.state;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Renova o token enquanto a sessão ainda vale.
   *
   * Sem isto a sessão morre em 12h e a operação descobre ao tentar enviar uma
   * mensagem. Falha em silêncio: se a renovação não passar, a sessão atual continua
   * valendo até expirar de fato e o 401 trata o resto.
   */
  static async renewToken(): Promise<void> {
    try {
      const res = await apiFetch('/api/auth/refresh', { method: 'POST' });
      if (!res.ok) return;
      const data = (await res.json()) as { token?: string };
      if (data.token) setAccessToken(data.token);
    } catch {
      // Rede instável no celular não deve derrubar a sessão em uso.
    }
  }

  static async refreshSession(): Promise<AuthState | null> {
    // No iPhone o cookie de sessão é bloqueado por ser third-party, então o token é a
    // única credencial. Uma sessão guardada sem token vem de um login anterior ao uso
    // de token ou de armazenamento descartado pelo navegador: ela renderiza o painel e
    // falha na primeira escrita. Melhor exigir login agora do que no meio do envio.
    if (this.getSession()?.isAuthenticated && !getAccessToken()) {
      this.clearStoredSession();
      return null;
    }

    const res = await apiFetch('/api/me', { method: 'GET' });
    if (!res.ok) {
      this.clearStoredSession();
      return null;
    }
    const data = (await res.json()) as { user?: { userId: string; name: string; email: string; role: BackendRole } };
    const payload = data.user;
    if (!payload) {
      this.clearStoredSession();
      return null;
    }

    const role = mapRole(payload.role);
    const user: User = {
      id: payload.userId,
      name: payload.name || '',
      email: payload.email || '',
      role,
      status: UserStatus.ATIVO,
      isOnline: true,
      permissions: permissionsForRole(role),
    };

    const authData: AuthState = {
      user,
      accessToken: null,
      isAuthenticated: true,
    };
    this.saveSession(authData);
    return authData;
  }

  static hasPermission(permission: string): boolean {
    const session = this.getSession();
    if (!session?.user) return false;
    if (session.user.role === UserRole.ADMIN) return true;
    return session.user.permissions.includes(permission) || session.user.permissions.includes('*');
  }

  static canAccessPainel(): boolean {
    const session = this.getSession();
    if (!session?.user) return false;
    return session.user.role === UserRole.ADMIN || session.user.role === UserRole.SUPERVISOR;
  }
}
