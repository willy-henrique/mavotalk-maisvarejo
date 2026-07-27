# Plano E2E e regressão — Mavo Talk

Data da inspeção: 2026-07-27.

## Estado atual

Não existe configuração Playwright nem suíte E2E no repositório. Existem 71 testes unitários/integração estática, que passaram no ambiente Windows do checkout; eles não substituem navegação autenticada, browser real, Socket.IO ou isolamento entre tenants.

## Configuração proposta

- Adicionar Playwright no projeto raiz, com `QA_BASE_URL` obrigatório e `QA_EMAIL`/`QA_PASSWORD` apenas em ambiente local/CI secreto.
- Projetos: Chromium 1366x768, Chromium 1920x1080, tablet e mobile 390x844.
- `storageState` separado por papel e tenant, criado por setup autenticado; não imprimir cookies, token ou senha.
- Capturar `console.error`, `pageerror`, respostas 400/401/403/404/409/422/500 e requisições pendentes ao final de cada teste.
- Trace e screenshot apenas em falha; vídeo somente no projeto de diagnóstico que realmente necessitar dele.
- Dados de teste devem usar `E2E_`, `QA_` ou `PLAYWRIGHT_`, com cleanup pelo próprio teste e escopo exclusivo de tenant QA.

## Matriz mínima

| Área | Casos prioritários |
| --- | --- |
| Autenticação | login válido/inválido/vazio, loading e double submit, logout, refresh, expiração, deep link e ausência de segredo em URL/log. |
| Navegação | item ativo, título/breadcrumb/título da aba, mouse/teclado, voltar/avançar, URL direta, menu recolhido/mobile e perfis admin/gestor/atendente. |
| Multi-tenancy | tentativas negativas A→B para todos os recursos, API, Socket.IO, agentes, auditoria, integrações e painel master. |
| Inbox | evento novo, ordenação, deduplicação, reconnect, envio/erro/retry, resposta rápida, atribuição/transferência/fila, fechamento/reabertura, concorrência em duas abas. |
| Contatos | busca, filtros, paginação, telefone BR/internacional/duplicado, bloqueio, consentimento e falhas de API. |
| WhatsApp | estados de conexão, QR expirado, provider/fallback, org sem configuração, assinatura/webhook inválido e duplicado. |
| Master | salvar cada configuração de organização, validar bot com nome da loja, validações, histórico e rollback. |
| Agentes | provisionamento, credencial/expiração, heartbeat, offline, sync parcial/retry/log, rotação e revogação. |
| Auditoria | filtros, período, usuário/origem, detalhe, paginação, exportação, RBAC e mascaramento. |
| Administração | equipe, filas, respostas rápidas, acessos gerenciais, auditoria de mutações e proteção no servidor. |

## Pré-condições bloqueantes

1. Definir localmente `QA_PASSWORD` e a origem de API correta da SPA QA; a URL informada é o host estático e devolve `index.html` em `/api/health`.
2. Disponibilizar dois tenants QA e três usuários QA (ADMIN, GESTOR, ATENDENTE) por tenant.
3. Disponibilizar provider WhatsApp/agent sandbox ou doubles controlados para não tocar dados de clientes.
4. Expor uma forma segura de criar e limpar fixtures QA sem permissões de plataforma fora do tenant de teste.

## Critérios de aprovação da suíte

- Nenhum erro de console/exceção não esperado e nenhuma resposta 4xx/5xx não explicitamente prevista.
- Toda mutação comprova estado final e auditoria, não apenas carregamento de página.
- Testes negativos A→B devolvem erro seguro e não recebem evento em tempo real.
- Relatório HTML/JUnit armazenado como artefato de CI, sem segredo, cookie ou PII desnecessária.
