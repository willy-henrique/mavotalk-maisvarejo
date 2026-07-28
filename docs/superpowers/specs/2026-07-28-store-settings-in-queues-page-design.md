# Configurações da loja dentro de "Filas e automações"

Data: 2026-07-28

## Contexto

O backend para configurar a identidade da loja usada pelo bot do WhatsApp (nome do assistente, nome da loja, endereço, link do mapa, telefone, texto/link/imagem das ofertas, horários por dia da semana, liga/desliga do bot e do fallback de IA) já existe e está completo:

- `lib/supermarket-settings.ts` — leitura/escrita das configurações e dos horários de funcionamento.
- `lib/supermarket-settings-validation.ts` — validação dos campos (limites de tamanho, URLs http/https, formato `HH:MM`, fuso fixo em `America/Sao_Paulo`).
- `app/api/admin/supermarket-settings` (GET/PATCH) e `app/api/admin/supermarket-settings/offers-image` (POST/DELETE).

Essas rotas já aceitam a sessão normal do tenant: `lib/supermarket-admin-auth.ts#requireSupermarketAdmin` primeiro tenta a sessão da SPA e libera para `role === "admin" || role === "gestor"`, só caindo para o painel master se não houver sessão de tenant. **Nenhuma mudança de backend é necessária.**

Hoje a única tela que expõe esse formulário é `components/mavo-admin.tsx` (painel master, rota `/mavo`), inacessível para o administrador comum do tenant — que é quem realmente precisa editar endereço, horário e ofertas no dia a dia. O pedido é trazer essa configuração para dentro do painel do tenant, na tela "Filas e automações" (`frontend/components/Admin/TicketTypeManagement.tsx`), que é onde o administrador já vai para mexer no menu do bot.

## Decisões já validadas com o usuário

1. A tela fica **embutida em "Filas e automações"**, não como um item de menu novo.
2. **Replicar os 3 blocos completos** do painel master: identidade da loja, ofertas (texto/link/imagem) e horários + toggles de bot ativo/fallback de IA.

## Arquitetura

- Novo arquivo `frontend/components/Admin/StoreSettings.tsx`: componente autocontido (fetch, estado de rascunho, salvar, upload/remoção de imagem, loading/erro). Fica separado de `TicketTypeManagement.tsx` porque tem responsabilidade, chamadas de API e ciclo de vida próprios — evita inflar ainda mais um arquivo que já gerencia CRUD de filas.
- `TicketTypeManagement.tsx` passa a renderizar `<StoreSettings />` em uma nova `<section>` logo abaixo do cabeçalho da página (que mantém o mesmo título "Filas e automações" e o botão "Nova fila"), antes da busca/filtro/lista de filas. Um divisor visual e um subtítulo "Filas do menu" separam as duas áreas.
- Sem mudança de rota, menu (`Sidebar.tsx` / `lib/menu-settings.ts`) ou permissão nova — a seção herda a mesma proteção de tela que já existe para "Filas e automações" (`admin_types`), e a API por trás dela já restringe a admin/gestor via `requireSupermarketAdmin`.

## Campos do formulário

Os limites e validações espelham exatamente `lib/supermarket-settings-validation.ts`, para o formulário nascer alinhado com o que o servidor aceita.

**1. Identidade da loja**
- Nome do assistente (obrigatório, até 80 caracteres)
- Nome da loja (obrigatório, até 160 caracteres)
- Endereço (opcional, até 300 caracteres)
- Link do mapa (opcional, precisa ser `http`/`https`)
- Telefone (opcional, até 40 caracteres)

**2. Ofertas**
- Texto do encarte (textarea, até 4000 caracteres)
- Link do encarte (opcional, precisa ser `http`/`https`)
- Upload/remoção de imagem (JPEG/PNG/WebP até 8 MB, via Cloudinary, reaproveitando `POST`/`DELETE /api/admin/supermarket-settings/offers-image`)

**3. Horários e automação**
- Grade dos 7 dias da semana: horário de abertura e fechamento (`HH:MM`) + alternância aberto/fechado por dia. Fuso fixo em `America/Sao_Paulo` (o backend rejeita qualquer outro valor).
- Toggle "Bot ativo".
- Toggle "Usar IA para mensagens não reconhecidas".

## Fluxo de dados

- **Carregar**: no mount, `GET /api/admin/supermarket-settings` → preenche o rascunho editável (`settings` + `businessHours`).
- **Salvar**: `PATCH /api/admin/supermarket-settings` com `{ ...settingsDraft, businessHours }` — mesmo contrato usado pelo painel master.
- **Upload/remover imagem de ofertas**: `POST`/`DELETE /api/admin/supermarket-settings/offers-image` via `apiFetch` com `FormData` (o `apiFetch` já detecta `FormData` e não força `Content-Type: application/json`, então nenhuma mudança é necessária em `frontend/services/api.ts`).
- Diferente do painel master, **não há diálogos de "descartar alterações"** — aqueles existem lá por causa do seletor de organização, que não existe na SPA do tenant (cada sessão já está presa a uma organização). Um indicador simples de "alterações não salvas" (texto ao lado do botão salvar) é suficiente.

## Estados de erro/carregamento

- Reaproveita `LoadingState`/`ErrorState` de `frontend/components/ui/PageState.tsx` (com botão "Tentar novamente"), já usados no resto do admin.
- Sucesso ao salvar usa o mesmo padrão de banner verde (`role="status"`) que `TicketTypeManagement.tsx` já usa para o CRUD de filas.
- Erros de validação retornados pelo servidor (ex.: "Nome do supermercado é obrigatório.") aparecem inline, no mesmo padrão do formulário de filas.

## Testes

- `tests/unit/` cobrindo, para `StoreSettings.tsx`: carregamento inicial (sucesso e erro), salvar configurações (sucesso e erro de validação do servidor), upload/remoção de imagem, edição da grade de horários — seguindo o padrão de testes já usado para as outras telas de Admin (`node:test` + mocks de `fetch`/`apiFetch`).
- Ajuste do teste estático `tests/unit/page-state-coverage.test.ts`, que hoje verifica `LoadingState`/`ErrorState` em cada tela de Admin, para incluir `StoreSettings.tsx` na lista.

## Fora de escopo

- Qualquer mudança de schema de banco ou nas rotas de API existentes.
- Expor essa configuração como item de menu separado (decisão explícita: fica embutida em "Filas e automações").
- Diálogos de "descartar alterações"/seletor de organização do painel master (não se aplicam ao contexto de tenant único da SPA).
