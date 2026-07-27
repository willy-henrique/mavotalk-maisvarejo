# Fase 1 — baseline e correção funcional de SLA

Data: 2026-07-27.

## Analisado

- Aplicações SPA, Next, Socket.IO, Postgres/Supabase, Redis/BullMQ, Baileys, Twilio e agentes.
- Sessão/RBAC, origem do tenant, RLS, webhooks, deduplicação, reconexão e workers.
- Rotas e componentes administrativos da SPA principal.

## Problemas encontrados e severidade

- **P1:** o SLA de primeira resposta não era agendado e o worker apenas escrevia log.
- **P1:** a barreira RLS não é aplicada de modo uniforme por todos os caminhos `queryDatabase`; requer validação e migração incremental para contexto estrito.
- **P2:** Sincronização e Agentes cloud são a mesma tela; Menu do painel recebe cabeçalho de Inbox; auditoria administrativa é insuficiente; workers de webhook/sync são estruturais.
- **P3:** inexistência de design system e inconsistências de tema, controles e densidade.

## Solução implementada nesta fase

- Criada a migration `202607270001_ticket_sla_breach.sql`, que registra `first_response_sla_breached_at` e índice para tickets pendentes.
- Centralizado o agendamento do SLA em `updateTicketByConversation`: sempre que o prazo é definido/recalculado, é criado um job com organização, conversa e vencimento.
- Jobs de SLA passaram a revalidar no banco, em transação com contexto de organização. Só marcam conversas abertas, ainda sem primeira resposta, cujo prazo atual venceu; o update condicional impede duplicidade.
- Cada vencimento efetivo cria auditoria `sla_first_response_breached` sem dados sensíveis. Jobs antigos de uma fila anterior são ignorados de forma segura.
- Corrigido o metadado da rota `Menu do painel`, que deixava o topo exibir indevidamente “Caixa de entrada”.
- O ambiente operacional agora inicia em modo escuro já no HTML, sem flash branco, e recebeu os primeiros tokens semânticos/regras reutilizáveis de superfície, campos e botões.

## Arquivos modificados

- `docs/current-architecture.md`
- `docs/route-inventory.md`
- `docs/ux-audit.md`
- `docs/security-multitenancy-audit.md`
- `docs/e2e-test-plan.md`
- `docs/audit-findings.md`
- `supabase/migrations/202607270001_ticket_sla_breach.sql`
- `lib/queues.ts`
- `lib/supabase-repo.ts`
- `lib/sla-worker.mjs`
- `worker.mjs`
- `frontend/components/AppHeader.tsx`
- `frontend/index.html`
- `frontend/index.css`

## Testes executados

No checkout Windows (necessário porque as dependências instaladas possuem binários Windows):

```text
npm run typecheck:all  → aprovado
npm test               → 71/71 aprovados
npm run build          → aprovado
git diff --check       → aprovado
```

## Riscos restantes

- A migration ainda precisa ser aplicada em uma base QA antes de o worker marcar vencimentos reais.
- O worker standalone não possui Socket.IO próprio; o estado persistido estará correto, mas a notificação visual em tempo real do vencimento será tratada junto ao redesign do Inbox/dashboard.
- A eficácia real de RLS depende do papel de conexão do banco e das migrations aplicadas; ainda precisa de teste A→B com dois tenants QA.
- Playwright não foi instalado porque faltam `QA_PASSWORD`, origem de API QA e tenants/usuários de teste controlados; o plano completo está em `docs/e2e-test-plan.md`.

## Próxima fase recomendada

Aplicar a migration em QA, executar teste de job SLA com uma conversa `QA_`, criar os dois tenants de isolamento e então instalar/configurar Playwright. Em seguida, criar tokens/primitives e corrigir AppShell, metadata de rota e consolidação Agentes/Sincronização.
