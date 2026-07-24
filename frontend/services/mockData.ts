
import { Ticket, TicketStatus, TicketPriority, User, UserRole, UserStatus, Customer, Message, TicketType } from '../types';

export const mockTicketTypes: TicketType[] = [
  { id: 'tt1', name: 'Sped Fiscal', color: '#8b5cf6', defaultPriority: TicketPriority.ALTA, slaResponseMin: 30, slaResolutionMin: 240, active: true, order: 1 },
  { id: 'tt2', name: 'Notas de Entrada', color: '#3b82f6', defaultPriority: TicketPriority.MEDIA, slaResponseMin: 60, slaResolutionMin: 480, active: true, order: 2 },
  { id: 'tt3', name: 'Nota de Saída', color: '#0ea5e9', defaultPriority: TicketPriority.MEDIA, slaResponseMin: 60, slaResolutionMin: 480, active: true, order: 3 },
  { id: 'tt4', name: 'Relatório', color: '#10b981', defaultPriority: TicketPriority.BAIXA, slaResponseMin: 120, slaResolutionMin: 720, active: true, order: 4 },
  { id: 'tt5', name: 'Balança', color: '#ef4444', defaultPriority: TicketPriority.URGENTE, slaResponseMin: 15, slaResolutionMin: 120, active: true, order: 5 },
  { id: 'tt6', name: 'Impressora', color: '#f59e0b', defaultPriority: TicketPriority.MEDIA, slaResponseMin: 60, slaResolutionMin: 360, active: true, order: 6 },
];

export const mockUsers: User[] = [
  { 
    id: 'u-admin', 
    name: 'Administrador Mavo Talk',
    email: 'admin@willtlk.com',
    password: 'admin123', 
    role: UserRole.ADMIN, 
    status: UserStatus.ATIVO,
    isOnline: true,
    permissions: ['*'],
    // Added lastLoginAt to match type definition
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 60 * 2)
  },
  { 
    id: 'u-willy', 
    name: 'Willy Colaborador', 
    email: 'willy@gmail.com',
    password: '123456', 
    role: UserRole.AGENT, 
    status: UserStatus.ATIVO,
    isOnline: true, 
    permissions: ['TICKET_READ', 'TICKET_REPLY'],
    // Added lastLoginAt to match type definition
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 60 * 24)
  }
];

export const mockCustomers: Customer[] = [
  { id: 'c1', name: 'João da Silva', company: 'Supermercado Central', email: 'joao@central.com', phone: '11988887777' }
];

export const mockTickets: Ticket[] = [
  {
    id: 'TKT-1001',
    subject: 'Impressora não imprime etiquetas',
    status: TicketStatus.AGUARDANDO,
    priority: TicketPriority.ALTA,
    customerId: 'c1',
    typeId: 'tt6',
    createdAt: new Date(Date.now() - 1000 * 60 * 45), // 45 min atrás
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    slaDeadline: new Date(Date.now() + 1000 * 60 * 120),
    isBotActive: false,
    // Added missing fields category and tags
    category: 'Infraestrutura',
    tags: ['Impressora', 'Etiqueta', 'Atendimento N1']
  }
];

export const mockMessages: Message[] = [
  {
    id: 'm1',
    ticketId: 'TKT-1001',
    senderId: 'c1',
    senderName: 'João da Silva',
    content: 'A impressora de gôndola parou de responder agora pouco.',
    createdAt: new Date(Date.now() - 1000 * 60 * 45),
    isInternal: false,
    type: 'TEXT'
  }
];

// Added missing mockRemoteAccess export to fix Vault component error
export const mockRemoteAccess = [
  { 
    id: 'ra1', 
    platform: 'AnyDesk', 
    accessId: '122 933 455', 
    passwordCrypted: 'will@2025', 
    ticketId: 'TKT-1001' 
  },
  { 
    id: 'ra2', 
    platform: 'TeamViewer', 
    accessId: '988 122 334', 
    passwordCrypted: 'secure#pass', 
    ticketId: 'TKT-1001' 
  },
  { 
    id: 'ra3', 
    platform: 'RDP', 
    accessId: '192.168.0.50', 
    passwordCrypted: 'admin_server', 
    ticketId: 'TKT-1001' 
  }
];
