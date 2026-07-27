# Inventário de rotas — baseline de auditoria

Data da inspeção: 2026-07-27.

## Fronteiras de frontend

| Grupo | Rotas | Implementação | Observação |
| --- | --- | --- | --- |
| SPA principal | `/inbox`, `/dashboard`, `/business`, `/business/sincronizacao`, `/business/auditoria`, `/contacts`, `/painel`, `/admin/*` | React Router em `frontend/App.tsx` | Interface operacional canônica. |
| Next legado/ponte | `/`, `/dashboard`, `/dashboard/queues`, `/login` | `app/` | A página raiz redireciona para a localização canônica configurada; não deve receber novas telas operacionais sem justificativa. |
| Master | `/mavo` | `app/mavo/page.tsx` + `components/mavo-admin.tsx` | Sessão master separada. |

## SPA operacional

| Rota | Tela | Perfil de UI | Fonte de dados principal |
| --- | --- | --- | --- |
| `/inbox` | `InboxConversations` | todos | conversas, mensagens, filas, respostas rápidas, Socket.IO |
| `/dashboard` | `Dashboard` | admin, gestor | `/api/dashboard/metrics` |
| `/business` | `BusinessAnalytics` | admin, gestor | analytics e consulta gerencial |
| `/business/sincronizacao` | `AgentsManagement` | admin | agentes cloud |
| `/business/auditoria` | `BusinessAudit` | admin | auditoria de consultas gerenciais |
| `/contacts` | `Contacts` | todos | contatos e histórico |
| `/painel` | `Painel` | admin, gestor | status/conexão WhatsApp |
| `/admin/usuarios` | `UserManagement` | admin | equipe |
| `/admin/tipos` | `TicketTypeManagement` | admin | filas e automações |
| `/admin/respostas-rapidas` | `QuickReplyManagement` | admin | respostas rápidas |
| `/admin/acessos-gerenciais` | `BusinessAccessManagement` | admin | acesso WhatsApp gerencial |
| `/admin/agentes` | redirecionamento para `/business/sincronizacao` | admin | URL legada preservada para bookmarks; não monta uma segunda experiência. |
| `/admin/menu-visibilidade` | `MenuSettings` | admin | visibilidade de navegação |

### Inconsistências identificadas

- A duplicidade entre `/business/sincronizacao` e `/admin/agentes` foi resolvida: a segunda URL redireciona para a canônica, mantendo compatibilidade.
- O metadado de `/admin/menu-visibilidade` foi incluído no `AppHeader`; a tela não usa mais o fallback “Caixa de entrada”.
- As rotas SPA não definem breadcrumbs nem atualizam o título da aba por rota.

## APIs por domínio

| Domínio | Rotas | Proteção observada |
| --- | --- | --- |
| Sessão | `/api/auth/login`, `/api/auth/logout`, `/api/me` | login público; demais cookie de sessão. |
| Atendimento | `/api/conversations`, `/api/conversations/[id]/{assign,close,messages,messages/upload,typing}` | `requireSession`; repositório recebe organização da sessão. |
| Contatos | `/api/contacts`, `/api/contacts/[id]`, `/api/contacts/[id]/start-conversation` | `requireSession`. |
| Operação | `/api/dashboard/metrics`, `/api/queues`, `/api/quick-replies`, `/api/whatsapp/*` | sessão e, onde necessário, `requireRole`. |
| Administração | `/api/admin/{users,agents,business-access,menu-settings,supermarket-settings,system-status}` | sessão/role; configuração de supermercado aceita sessão administrativa ou sessão master. |
| Negócio | `/api/business/{analytics,audit,query}` | sessão, role e feature flags. |
| Agentes | `/api/agent/v1/{config,heartbeat,sync/*}` | HMAC, nonce/timestamp e validação Zod; não cookie. |
| Webhooks | `/api/webhooks/{twilio,n8n/ticket-upsert,cerebro/reply}` | assinatura Twilio ou token bearer específico; sem sessão de usuário. |
| Master | `/api/mavo/{auth,overview,actions/sync-supermarket}` | autenticação master específica. |
| Saúde | `/api/health`, `/api/readiness` | públicos, sem dados operacionais. |

## Dados, estado e estilos

- Estado de sessão: `AuthService` + cookie no backend; tema: `ThemeProvider`; estados de página são locais aos componentes.
- Serviços de HTTP: `frontend/services/api.ts`, com `credentials: include` e evento de sessão expirada em 401.
- Tempo real: `socket.io-client` dentro do Inbox.
- Estilos: Tailwind, com classes extensas dentro das telas. `frontend/index.css` possui somente base, foco, skeleton e scrollbar; não há tokens/componentes de design system.
- Erro global: `AppErrorBoundary`; telas têm tratamento de erro heterogêneo.

## Componentes duplicados ou acoplamentos

- Botões, cards, filtros, inputs, tabelas, modais, empty states e badges são implementados por página, sem primitives compartilhadas.
- `AgentsManagement` possui uma rota canônica; `/admin/agentes` é somente compatibilidade de URL.
- `MENU_ITEMS` no backend e `menuItems` na sidebar são duas fontes que precisam permanecer manualmente sincronizadas.
- A autorização simplificada da SPA (`permissionsForRole`) não é a matriz granular de permissão que o produto pede; a decisão efetiva precisa permanecer no servidor.
