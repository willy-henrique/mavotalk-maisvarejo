# Auditoria de segurança e multi-tenancy — baseline

Data da inspeção: 2026-07-27. Esta é uma auditoria estática; validação de RLS e isolamento entre duas organizações exige credenciais e tenants QA distintos.

## Controles encontrados

| Controle | Estado observado |
| --- | --- |
| Sessão | JWT assinado em cookie HTTP-only; emissor/audience são validados e o usuário ativo é relido no banco. |
| RBAC | Sessão é relida no banco e as rotas operacionais/administrativas usam `requireMenuPermission` por recurso/ação; a matriz é resolvida no servidor por organização. A UI não é a barreira de acesso. |
| Escopo de tenant | Repositório operacional recebe `organizationId` da sessão e filtros explícitos de `organization_id`. |
| RLS | Migration cria políticas por `organization_id`; `withTenantTransaction` instala `app.organization_id` e recusa IDs de tenant fora do formato técnico antes de executar SQL. |
| Socket.IO | Handshake valida sessão e entra apenas na sala da organização; emissões usam a mesma sala. |
| Twilio | Assinatura, limite de payload e deduplicação de `MessageSid`. |
| n8n | Bearer token por organização, Zod, deduplicação de eventos e comparação timing-safe. |
| Agentes | Assinatura HMAC, nonce/timestamp, payload limitado, schema validado e segredos cifrados. |
| SQL injection | Consultas inspecionadas usam parâmetros (`$n`), sem concatenação de payload do usuário nas consultas analisadas. |

## Problemas e riscos

| Severidade | Risco | Causa raiz | Correção recomendada |
| --- | --- | --- | --- |
| Resolvido | SLA prometido não possuía execução efetiva | O agendamento por ticket, worker transacional, idempotência e auditoria foram implementados e cobertos por teste arquitetural. A confirmação de que o worker está ativo no Render ainda exige observabilidade de produção. |
| P1 | RLS não é uma garantia demonstrável para todos os caminhos | Os caminhos administrativos críticos foram migrados para o helper tenant-aware, mas módulos legados ainda usam `queryDatabase` com filtro explícito. A efetividade também depende de o papel de conexão não ser owner/BYPASSRLS. | migrar os caminhos restantes, usar papel de aplicação sem `BYPASSRLS`, considerar `FORCE ROW LEVEL SECURITY` e verificar políticas aplicadas na base QA. |
| Resolvido | Master limitado à organização padrão | O master agora lista organizações apenas sob sessão de plataforma e valida a existência do tenant antes de overview, sincronização ou gravação de configurações. Sessões operacionais ignoram o header de seleção e permanecem no tenant autenticado. |
| Resolvido | Menu só escondia itens, sem política configurável de ação | A configuração persistia apenas visibilidade, enquanto as APIs tinham papéis fixos. | `menu_permission_overrides` armazena overrides por organização; padrões seguros continuam no código e `requireMenuPermission` protege as rotas mapeadas. A confirmação dinâmica com dois tenants QA permanece pendente. |
| Resolvido | Erro de ordem em consulta estrita da Auditoria | `queryTenantDatabase` aceitava dois parâmetros textuais, permitindo passar SQL como contexto sem erro de tipo. | A rota foi corrigida e o helper agora valida o identificador técnico antes de abrir a transação, falhando de forma segura. |
| P2 | Worker de webhook e agente-sync é estrutural | processadores apenas registram logs e não há produtor para SLA/webhook/agent-sync além de limpeza de mídia | remover fila morta ou implementar fluxo completo com observabilidade, DLQ e testes. |
| P2 | CSRF requer validação dinâmica no ambiente | O servidor aceita apenas origens configuradas e agora recusa mutações autenticadas por cookie sem `Origin`; webhooks e agentes sem cookie permanecem fora dessa regra. Ainda é necessário confirmar os cabeçalhos reais e a configuração `SameSite` no QA publicado. |
| P2 | Auditoria administrativa não é uniformemente demonstrada | Configurações, filas, usuários, agentes, acessos gerenciais e respostas rápidas auditam as mutações principais com payload mascarado. Ainda falta inventariar e centralizar todas as mutações administrativas futuras em uma única política. |
| P2 | Nome técnico de tenant aparece na experiência | IDs são usados como dado de interface em fluxos administrativos | usar nome amigável; manter ID apenas em detalhe/tooltip e logs técnicos. |

## Escopo de dados por origem

- **Usuário autenticado:** organização sempre vem da sessão retornada por `requireSession`; não deve ser aceita do body/query.
- **Webhook:** não existe sessão de usuário. A organização é resolvida por canal (Twilio) ou associada a token configurado (n8n); manter tokens exclusivos por organização e rotacionáveis.
- **Agente:** a organização decorre da instalação autenticada, nunca do payload do agente.
- **Master:** só pode escolher organização por autorização de plataforma explícita e auditada; não aceitar ID de tenant fornecido pelo navegador como autoridade.

## Testes de segurança obrigatórios para a próxima etapa

1. Criar dois tenants QA e usuários com mesmo perfil.
2. Tentar IDs de contato, conversa, ticket, fila, auditoria, agente e integração do tenant B com sessão do A.
3. Tentar entrar manualmente em sala Socket.IO do tenant B e publicar evento.
4. Executar uma mutação administrativa com cookie válido e origem não permitida.
5. Reenviar webhook e evento de agente, incluindo timestamp expirado/nonce repetido.
6. Consultar no banco, com papel de aplicação, que RLS recusa `SELECT` sem `app.organization_id` e recusa tenant diferente.
