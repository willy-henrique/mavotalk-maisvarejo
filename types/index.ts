export type SessionUser = {
  userId: string;
  organizationId: string;
  role: "admin" | "gestor" | "atendente";
  name: string;
  email: string;
};

export type Queue = {
  id: string;
  name: string;
  menuOption: number;
  colorHex: string;
  defaultSlaMins: number;
  isActive: boolean;
};

export type Message = {
  id: string;
  direction: "inbound" | "outbound";
  type: "text" | "image" | "document";
  content: string;
  mediaUrl?: string | null;
  createdAt: string;
};

export type Conversation = {
  id: string;
  status: "aguardando" | "em_atendimento" | "pendente_cliente" | "encerrado";
  triageCompleted: boolean;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string | null;
    phoneNumber: string;
  };
  queue: Queue | null;
  ticket: {
    id: string;
    assigneeId: string | null;
    closeReason: string | null;
    firstResponseDueAt: string | null;
    assignee?: {
      id: string;
      name: string;
      email: string;
    } | null;
  } | null;
  messages: Message[];
};

