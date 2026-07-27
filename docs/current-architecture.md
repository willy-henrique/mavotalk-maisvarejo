# Arquitetura atual — baseline de auditoria

Data da inspeção: 2026-07-27. Este documento descreve o que está no repositório; não presume que a infraestrutura remota tenha todas as migrations aplicadas.

## Visão geral

Mavo Talk é uma aplicação multiempresa de atendimento por WhatsApp. A interface operacional é uma SPA React/Vite em `frontend/`; a aplicação Next.js na raiz é o BFF/backend, webhooks e páginas legadas. O processo de produção pode ser iniciado por `server.cjs`, que sobe Next e Socket.IO no mesmo servidor HTTP.

```text
SPA React/Vite (frontend/) ──cookie de sessão──> Next API (app/api/)
        │                                              │
        └──── Socket.IO <──── room organization:<id> ──┤
                                                       ├── Postgres/Supabase
WhatsApp (Baileys ou Twilio) ──webhooks───────────────┤
Agentes locais ──HMAC/replay protection───────────────┤
                                                       └── Redis/BullMQ
```

## Aplicações e responsabilidades

| Área | Implementação atual | Responsabilidade |
| --- | --- | --- |
| Interface operacional | `frontend/`, React 19, Vite, React Router | Inbox, contatos, métricas, administração e conexão WhatsApp. |
| Backend | Next.js 16 em `app/api/` | Sessão, RBAC, APIs, regras de negócio, webhooks e upload. |
| Processo HTTP e tempo real | `server.cjs`, Socket.IO | Autentica o socket, resolve usuário/organização, entra apenas em `organization:<id>`. |
| Dados | Postgres via `pg`; `lib/repo.ts` reexporta `lib/supabase-repo.ts` | Dados operacionais, configurações, auditoria, agentes e analytics. |
| Isolamento secundário | `supabase/migrations/202607230004_rls_policies.sql` | RLS baseada em `app.organization_id`; `withTenantTransaction` configura o contexto transacional. |
| Filas | BullMQ/Redis, `lib/queues.ts`, `worker.mjs` | SLA de primeira resposta é agendado e revalidado de forma idempotente; limpeza de mídia e sync de agentes usam a mesma infraestrutura. |
| WhatsApp | Baileys e Twilio | Baileys é o padrão do Render; Twilio valida assinatura e resolve a organização pelo canal. |
| Painel master | `app/mavo`, `components/mavo-admin.tsx` | Autenticação própria de plataforma, seletor de organização validado no servidor, visão e configuração do tenant selecionado. |

## Autenticação, sessão e RBAC

- `lib/auth.ts` emite JWT HS256 de 12 horas em cookie HTTP-only. Em produção exige segredo com ao menos 32 caracteres.
- `lib/api.ts` verifica a assinatura do JWT e relê o usuário ativo no banco usando **organização + usuário** antes de devolver a sessão.
- As APIs administrativas usam `requireSession` e `requireRole`; agentes utilizam autenticação HMAC própria em `app/api/agent/v1/_shared.ts`.
- A SPA usa `/api/me` como fonte de verdade após login e refresh. O `localStorage` mantém apenas metadados de UI da sessão, não o token.
- O RBAC da SPA controla experiência e redirecionamento, mas as rotas administrativas também aplicam RBAC no servidor. A configuração de visibilidade do menu não é a autorização do backend.

## Multi-tenancy e persistência

- O repositório operacional recebe `organizationId` e filtra consultas por `organization_id`.
- As migrations habilitam RLS para entidades multiempresa e definem políticas dependentes de `mavo_current_organization_id()`.
- `withTenantTransaction` define `app.organization_id` dentro da transação; os fluxos administrativos críticos usam esse helper. O módulo ainda possui `queryDatabase` genérico em caminhos legados com filtro explícito por organização, que permanece item de migração e verificação dinâmica.
- Configurações do supermercado são colunas da tabela `organizations`; `getSupermarketBotConfigForOrganization` é chamado antes de decidir respostas do bot. Não há Firestore no projeto.
- A configuração de loja/assistente é, portanto, por organização e não fixa no código. Variáveis de ambiente continuam como fallback para bancos ainda não migrados.

## Tempo real, idempotência e integrações

- No handshake do Socket.IO, `server.cjs` valida o cookie/JWT e chama `/api/me`; só então junta o socket à sala da própria organização. `lib/realtime.ts` emite para essa sala.
- `InboxConversations.tsx` refaz a leitura ao receber eventos de conversa/mensagem e quando o socket reconecta.
- Twilio valida `x-twilio-signature`, limita payload e deduplica por `MessageSid`/`external_id` antes de persistir.
- O webhook n8n valida bearer token por organização, valida payload com Zod e deduplica `event_id`/mensagens. O roteamento gerencial de WhatsApp acontece antes de abrir uma conversa comum.
- Agentes cloud validam assinatura, timestamp, nonce, versão de schema, tamanho e tipo do payload.

## Execução em produção

`render.yaml` configura dois serviços: `mavo-talk-web` (SPA estática) e `mavo-talk-api` (Next/Socket.IO). No plano gratuito, `MAVO_INLINE_WORKER=true` executa workers no processo web e o Redis é explicitamente best-effort; a disponibilidade de SLA e sincronização não pode depender desse arranjo.

## Limites desta auditoria

- Foi possível analisar código e executar build, lint, typecheck e testes unitários locais.
- A URL QA pública não aceita chamadas de API no mesmo host (o static host devolve o `index.html`); a origem de API configurada no Render não é pública no repositório.
- Não foi executado login nem foram criados dados porque `QA_PASSWORD` não está definido localmente. Não há evidência dinâmica suficiente para declarar que RLS, jobs, Socket.IO ou todas as migrations estão ativos na produção.
