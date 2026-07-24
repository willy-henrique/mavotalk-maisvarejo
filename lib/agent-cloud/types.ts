export type AgentDataType =
  | "sales_daily"
  | "product_sales_daily"
  | "inventory_entries_daily";

export type AgentContext = {
  agentId: string;
  installationKey: string;
  organizationId: string;
  agentName: string;
  keyVersion: number;
  requestId: string;
  sourceIp: string | null;
};

export type AgentInstallation = {
  id: string;
  organizationId: string;
  name: string;
  installationKey: string;
  status: "provisioned" | "online" | "offline" | "revoked" | "error";
  agentVersion: string | null;
  schemaVersion: string | null;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentSyncResult = {
  accepted: true;
  batchId: string;
  duplicate: boolean;
  receivedRecords: number;
  processedRecords: number;
  rejectedRecords: number;
  serverTime: string;
  nextSyncAfterSeconds: number;
};

export type ProvisionedAgentCredential = {
  agent: AgentInstallation;
  agentId: string;
  secret: string;
  keyVersion: number;
};
