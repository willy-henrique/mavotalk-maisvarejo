# Configurações da loja dentro de "Filas e automações"

Data: 2026-07-28 (revisado no mesmo dia após feedback do usuário vendo a tela real)

## Contexto

O backend para configurar a identidade da loja usada pelo bot do WhatsApp (nome do assistente, nome da loja, endereço, link do mapa, telefone, texto/link/imagem das ofertas, horários por dia da semana, liga/desliga do bot e do fallback de IA) já existe e está completo:

- `lib/supermarket-settings.ts` — leitura/escrita das configurações e dos horários de funcionamento.
- `lib/supermarket-settings-validation.ts` — validação dos campos (limites de tamanho, URLs http/https, formato `HH:MM`, fuso fixo em `America/Sao_Paulo`).
- `app/api/admin/supermarket-settings` (GET/PATCH) e `app/api/admin/supermarket-settings/offers-image` (POST/DELETE).

Essas rotas já aceitam a sessão normal do tenant: `lib/supermarket-admin-auth.ts#requireSupermarketAdmin` primeiro tenta a sessão da SPA e libera para `role === "admin" || role === "gestor"`, só caindo para o painel master se não houver sessão de tenant. **Nenhuma mudança de backend é necessária.**

Hoje a única tela que expõe esse formulário é `components/mavo-admin.tsx` (painel master, rota `/mavo`), inacessível para o administrador comum do tenant. Sem essa configuração preenchida, o bot cai em atendimento humano sempre que alguém escolhe a opção 1 (Ofertas) ou 2 (Horários e localização) — `optionDecision` em `lib/supermarket-bot.ts` detecta que não há `offersText`/`offersUrl`/`offersImageUrl` (ou `address`/`mapsUrl`/horários) configurados e desiste do autoatendimento. Isso é o sintoma que motivou o pedido: o cliente digita "1" e cai direto num "vou te encaminhar para a equipe" em vez de ver as ofertas.

## Decisões validadas com o usuário

1. A tela fica **embutida em "Filas e automações"**, não como um item de menu novo.
2. **Revisão (2026-07-28):** depois de ver o modal "Editar fila" atual (só nome, opção no menu, cor, SLA, ativo), o usuário pediu que o conteúdo fique **dentro de cada fila**, não num painel único no topo. Desenho final, confirmado:
   - Um **bloco pequeno fixo no topo** da página só com o que é verdadeiramente global (afeta toda mensagem do bot, não uma opção específica): nome do assistente, nome da loja, toggle "Bot ativo", toggle "Usar IA para mensagens não reconhecidas".
   - O **modal "Editar fila" da fila "Ofertas e promoções" (menuOption 1)** ganha uma seção extra "Conteúdo enviado ao cliente": texto do encarte, link do encarte, upload/remoção da imagem do encarte.
   - O **modal "Editar fila" da fila "Horários e localização" (menuOption 2)** ganha uma seção extra "Conteúdo enviado ao cliente": endereço, link do mapa, telefone, grade de horários dos 7 dias da semana.
   - As demais filas (Produtos e disponibilidade, Açougue/padaria/hortifruti, Trocas/devoluções/pagamentos, Falar com um atendente) **não ganham campos extras** — não têm resposta automática própria, só coletam contexto e encaminham para humano (`collectDetailsReply` em `lib/supermarket-bot.ts`).

## Arquitetura

- Sem componente novo: tudo entra em `frontend/components/Admin/TicketTypeManagement.tsx`, que já é o dono do estado de filas e do modal de edição. Um arquivo separado faria sentido para um painel isolado, mas como o conteúdo agora vive dentro do fluxo de edição de fila que já existe ali, mantém-se junto.
- Estado novo no componente:
  - `storeSettings` / `storeHours`: carregados uma vez (`GET /api/admin/supermarket-settings`) junto com `fetchQueues`, usados tanto pelo bloco global quanto para inicializar os campos extras do modal.
  - Bloco global: rascunho próprio (`identityBotName`, `identityStoreName`, `identityEnabled`, `identityAiFallback`) com seu próprio botão salvar, erro e notice — independente do formulário de fila.
  - Modal de fila: quando `editingId` existe e a fila sendo editada tem `menuOption === 1` ou `=== 2`, campos extras (`formOffersText`, `formOffersUrl`, campos de oferta / `formAddress`, `formMapsUrl`, `formPhone`, `formHours`) aparecem numa seção adicional dentro do mesmo `<Dialog>`, inicializados a partir de `storeSettings`/`storeHours` em `openEdit`.
  - Ao criar uma fila nova (`openCreate`), os campos extras não aparecem — eles só fazem sentido para as duas filas de autoatendimento que já existem via o preset padrão, não para uma fila recém-criada.
- Sem mudança de rota, menu (`Sidebar.tsx` / `lib/menu-settings.ts`) ou permissão nova — tudo herda a mesma proteção de tela que já existe para "Filas e automações" (`admin_types`), e a API por trás já restringe a admin/gestor via `requireSupermarketAdmin`.

## Campos

Os limites e validações espelham exatamente `lib/supermarket-settings-validation.ts`.

**Bloco global (topo da página)**
- Nome do assistente (obrigatório, até 80 caracteres)
- Nome da loja (obrigatório, até 160 caracteres)
- Toggle "Bot ativo"
- Toggle "Usar IA para mensagens não reconhecidas"

**Modal "Editar fila" — Ofertas e promoções (menuOption 1)**
- Texto do encarte (textarea, até 4000 caracteres)
- Link do encarte (opcional, precisa ser `http`/`https`)
- Upload/remoção de imagem (JPEG/PNG/WebP até 8 MB, via Cloudinary, reaproveitando `POST`/`DELETE /api/admin/supermarket-settings/offers-image`)

**Modal "Editar fila" — Horários e localização (menuOption 2)**
- Endereço (opcional, até 300 caracteres)
- Link do mapa (opcional, precisa ser `http`/`https`)
- Telefone (opcional, até 40 caracteres)
- Grade dos 7 dias da semana: horário de abertura/fechamento (`HH:MM`) + alternância aberto/fechado. Fuso fixo em `America/Sao_Paulo`.

## Fluxo de dados

- **Carregar**: no mount, junto com `fetchQueues`, `GET /api/admin/supermarket-settings` preenche `storeSettings`/`storeHours` e o rascunho do bloco global.
- **Salvar bloco global**: `PATCH /api/admin/supermarket-settings` com só `{ botName, storeName, enabled, aiFallbackEnabled }` — a API aceita patch parcial (`parseSupermarketSettingsPatch` só valida os campos presentes no body).
- **Salvar fila 1 ou 2**: `handleSubmit` do modal continua fazendo o `PATCH/POST /api/queues[...]` de sempre para nome/cor/SLA/ativo; quando a fila é 1 ou 2, também dispara `PATCH /api/admin/supermarket-settings` com o subconjunto relevante (`offersText`/`offersUrl` para a 1; `address`/`mapsUrl`/`phone`/`businessHours` para a 2).
- **Upload/remover imagem de ofertas**: `POST`/`DELETE /api/admin/supermarket-settings/offers-image` via `apiFetch` com `FormData`, disponível diretamente dentro do modal da fila 1, com efeito imediato (não depende do botão "Atualizar" do modal).

## Estados de erro/carregamento

- Bloco global e modal de fila reaproveitam o mesmo padrão de banner verde/vermelho que `TicketTypeManagement.tsx` já usa para o CRUD de filas.
- Erros de validação retornados pelo servidor (ex.: "Nome do supermercado é obrigatório.", "Link do mapa é inválido.") aparecem inline, mesmo padrão do formulário de filas.

## Testes

- `tests/unit/`: teste do bloco global (carregar, salvar, erro de validação) e do modal estendido para filas 1 e 2 (campos aparecem só para essas duas, upload/remoção de imagem, grade de horários), seguindo o padrão `node:test` + mocks de `fetch`/`apiFetch` já usado nas outras telas de Admin.

## Fora de escopo

- Qualquer mudança de schema de banco ou nas rotas de API existentes.
- Expor essa configuração como item de menu separado.
- Campos extras nas demais filas (Produtos, Açougue, Trocas, Atendente) — elas não têm conteúdo de autoatendimento próprio.
- Diálogos de "descartar alterações"/seletor de organização do painel master (não se aplicam ao contexto de tenant único da SPA).
