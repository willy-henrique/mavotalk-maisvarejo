import { apiFetch, apiGet, apiPost } from './api';
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
    await apiPost('/api/auth/login', { email, password });
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
      this.state = { user: null, accessToken: null, isAuthenticated: false };
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
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

  static async refreshSession(): Promise<AuthState | null> {
    const res = await apiFetch('/api/me', { method: 'GET' });
    if (!res.ok) {
      this.state = { user: null, accessToken: null, isAuthenticated: false };
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    const data = (await res.json()) as { user?: { userId: string; name: string; email: string; role: BackendRole } };
    const payload = data.user;
    if (!payload) {
      this.state = { user: null, accessToken: null, isAuthenticated: false };
      localStorage.removeItem(AUTH_STORAGE_KEY);
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
