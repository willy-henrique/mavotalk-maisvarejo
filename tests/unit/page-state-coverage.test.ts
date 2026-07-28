import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("estados de página compartilhados cobrem áreas administrativas e operacionais", async () => {
  const [states, statusBadge, dashboard, audit, agents, quickReplies, businessAccess, contacts, users, queues, menuSettings] = await Promise.all([
    readFile("frontend/components/ui/PageState.tsx", "utf8"),
    readFile("frontend/components/ui/StatusBadge.tsx", "utf8"),
    readFile("frontend/components/Dashboard.tsx", "utf8"),
    readFile("frontend/components/BusinessAudit.tsx", "utf8"),
    readFile("frontend/components/Admin/AgentsManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/QuickReplyManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/BusinessAccessManagement.tsx", "utf8"),
    readFile("frontend/components/Contacts.tsx", "utf8"),
    readFile("frontend/components/Admin/UserManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/MenuSettings.tsx", "utf8"),
  ]);

  assert.match(states, /export function LoadingState/);
  assert.match(states, /export function EmptyState/);
  assert.match(states, /export function ErrorState/);
  assert.match(statusBadge, /export function StatusBadge/);
  assert.match(statusBadge, /StatusTone/);
  assert.match(contacts, /StatusBadge/);
  assert.match(queues, /StatusBadge/);
  assert.match(agents, /StatusBadge/);
  assert.match(audit, /StatusBadge/);
  assert.match(businessAccess, /StatusBadge/);
  assert.match(users, /StatusBadge/);
  assert.match(dashboard, /LoadingState/);
  assert.match(dashboard, /ErrorState/);
  assert.match(dashboard, /loadRequestRef/);
  for (const source of [audit, agents, quickReplies, businessAccess, contacts, users, queues, menuSettings]) {
    assert.match(source, /ErrorState/);
    assert.match(source, /Tentar novamente/);
  }
});
