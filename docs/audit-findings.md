# Achados priorizados — baseline 2026-07-27

## P0 — nenhum confirmado estaticamente

Não foi confirmado vazamento entre organizações, autenticação quebrada, perda de dados ou indisponibilidade total. Isso **não** é aprovação de produção: falta executar os testes negativos com dois tenants QA e confirmar RLS na base em uso.

## P1 — corrigir antes do redesign amplo

| ID | Problema | Causa raiz | Evidência |
| --- | --- | --- | --- |
| P1-01 | SLA vencido não é executado | `enqueueSlaCheck` não é chamado e `worker.mjs` só registra `sla_check`, sem atualizar ticket, emitir evento, notificar ou auditar. | `lib/queues.ts`, `worker.mjs`; busca estática não encontrou produtor. |
| P1-02 | A segunda barreira de tenant é inconsistente | Há consultas por `queryDatabase` fora de `withTenantTransaction`. Os filtros explícitos são bons, mas não instalam `app.organization_id`; RLS depende da configuração do papel de banco. | `lib/db.ts`, `lib/supermarket-settings.ts`, `lib/menu-settings.ts`, módulos de analytics/acesso/agente. |

## P2 — impacto relevante de operação, confiabilidade ou usabilidade

| ID | Problema | Causa raiz | Evidência |
| --- | --- | --- | --- |
| P2-01 | “Sincronização” e “Agentes cloud” são duplicados | Ambas as rotas renderizam `AgentsManagement`. | `frontend/App.tsx`, `frontend/Sidebar.tsx`. |
| P2-02 | Cabeçalho de Menu do painel está errado | A rota não existe em `pageMeta`; o fallback é Inbox. | `frontend/components/AppHeader.tsx`. |
| P2-03 | Auditoria ainda não é ferramenta operacional | Sem filtros, ordenação, busca, detalhe, exportação e paginação server-side. | `frontend/components/BusinessAudit.tsx`. |
| P2-04 | Processadores BullMQ incompletos | Workers `webhooks` e `agent-sync` apenas logam; não há produtores observados para SLA/webhook/agent sync. | `lib/queues.ts`, `worker.mjs`. |
| P2-05 | Administração não possui sistema único de feedback | Estados loading/sucesso/erro/confirmação variam por tela e ações destrutivas não têm padrão. | Componentes em `frontend/components/Admin/`. |
| P2-06 | Modal e dropdown não atendem o fluxo acessível completo | Não há primitive com focus trap, Escape e retorno de foco. | `Contacts.tsx` e modais administrativos. |
| P2-07 | Painel master não é seletor multiempresa seguro | Escopo usa organização padrão, sem modelo explícito de plataforma/impersonation auditada. | `/api/mavo/*`, `DEFAULT_ORG_ID`. |
| P2-08 | Não há E2E browser real | O repositório não contém Playwright/Cypress. | `package.json`, diretório `tests/`. |

## P3 — refinamento e padronização

| ID | Problema | Evidência |
| --- | --- | --- |
| P3-01 | Falta Design System/tokens semânticos | Tailwind por página; `index.css` só define base e utilitários. |
| P3-02 | Tema visual não é uniformemente aplicado | Theme provider inicia em dark, mas base e superfícies são declaradas por componente. |
| P3-03 | Botões, títulos, capitalização e empty states variam | Equipe, Filas, Respostas, Agentes e Acessos têm padrões próprios. |
| P3-04 | IDs técnicos podem dominar telas administrativas | A experiência precisa priorizar nome amigável e usar ID como detalhe secundário. |
| P3-05 | Área útil insuficiente em telas grandes | Cards/empty states usam altura e largura fixas em páginas de operação. |

## Ordem recomendada

1. Resolver P1-01 e validar P1-02 com testes de tenant/RLS.
2. Criar a infraestrutura Playwright e fixtures QA controladas.
3. Consolidar navegação/metadata, Agentes/Sincronização e primitives de UI.
4. Migrar administração incrementalmente, depois Inbox, dashboards e contatos.
