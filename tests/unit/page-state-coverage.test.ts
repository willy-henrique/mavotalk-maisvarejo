import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("estados de página compartilhados cobrem áreas administrativas e operacionais", async () => {
  const [states, dashboard, analytics, audit, agents, quickReplies, businessAccess, contacts, users, queues, menuSettings] = await Promise.all([
    readFile("frontend/components/ui/PageState.tsx", "utf8"),
    readFile("frontend/components/Dashboard.tsx", "utf8"),
    readFile("frontend/components/BusinessAnalytics.tsx", "utf8"),
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
  assert.match(dashboard, /LoadingState/);
  assert.match(dashboard, /ErrorState/);
  assert.match(dashboard, /loadRequestRef/);
  for (const source of [analytics, audit, agents, quickReplies, businessAccess, contacts, users, queues, menuSettings]) {
    assert.match(source, /ErrorState/);
    assert.match(source, /Tentar novamente/);
  }
});
