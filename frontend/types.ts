
export enum UserStatus {
  ATIVO = 'ATIVO',
  INATIVO = 'INATIVO',
  PENDENTE = 'PENDENTE'
}

export enum TicketStatus {
  AGUARDANDO = 'AGUARDANDO',
  ATENDENDO = 'ATENDENDO',
  PENDENTE = 'PENDENTE',
  RESOLVIDO = 'RESOLVIDO',
  FECHADO = 'FECHADO'
}

export enum TicketPriority {
  BAIXA = 'BAIXA',
  MEDIA = 'MEDIA',
  ALTA = 'ALTA',
  URGENTE = 'URGENTE'
}

export enum UserRole {
  ADMIN = 'ADMIN',
  SUPERVISOR = 'SUPERVISOR',
  AGENT = 'AGENT'
}

export interface TicketType {
  id: string;
  name: string;
  color: string;
  defaultPriority: TicketPriority;
  slaResponseMin: number;
  slaResolutionMin: number;
  active: boolean;
  order: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  status: UserStatus;
  avatar?: string;
  isOnline: boolean;
  permissions: string[];
  // Added lastLoginAt to fix UserManagement component error
  lastLoginAt?: Date;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
}

export interface Message {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: Date;
  isInternal: boolean;
  type: 'TEXT' | 'ATTACHMENT' | 'SYSTEM' | 'BOT_MENU';
}

export interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  customerId: string;
  agentId?: string;
  typeId?: string; // ID do TicketType
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  slaDeadline: Date;
  isBotActive: boolean;
  // Added missing properties used in TicketDetailPanel and Dashboard
  category?: string;
  tags: string[];
}

export interface Customer {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
}
