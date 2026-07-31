export type Role = "admin" | "gestor" | "atendente";

export type ConversationStatus =
  | "aguardando"
  | "em_atendimento"
  | "pendente_cliente"
  | "encerrado";

export type FireUser = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
};

export type FireQueue = {
  id: string;
  organizationId: string;
  name: string;
  menuOption: number;
  colorHex: string;
  defaultSlaMins: number;
  isActive: boolean;
  queueType?: "custom" | "offers_promotions" | "business_hours_location";
};

export type FireConversation = {
  id: string;
  organizationId: string;
  contactId: string;
  contactPhone?: string;
  queueId?: string | null;
  status: ConversationStatus;
  triageCompleted: boolean;
  menuAttempts: number;
};

export type FireBusinessHour = {
  id: string;
  organizationId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  breakStartTime?: string | null;
  breakEndTime?: string | null;
  timezone: string;
  isActive: boolean;
};

export type FireQuickReply = {
  id: string;
  organizationId: string;
  name: string;
  content: string;
  category?: string | null;
  createdAt?: string;
};

export type ListContactItem = {
  id: string;
  name: string;
  phoneNumber: string;
  lastMessage: string | null;
  lastInteraction: string | null;
  status: "ativo" | "encerrado";
  blocked: boolean;
  internalNote: string | null;
  lastConversationId: string | null;
};

export type ContactAndConversation = {
  contact: {
    id: string;
    organizationId: string;
    phoneNumber: string;
    name: string;
  };
  conversation: FireConversation & { isNew: boolean };
};
