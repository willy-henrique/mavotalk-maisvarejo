# Mavo Talk - Central de Conversas WhatsApp

Sistema profissional de atendimento com triagem numerica, fila `Aguardando`, cards por demanda e chat em tempo real.

> A marca do produto agora é **Mavo Talk**. Variáveis `WILLTALK_*`, rotas de integração e identificadores persistidos foram mantidos por compatibilidade com os ambientes já configurados.

## Bot para supermercado

O projeto inclui o **Mavo**, um assistente de WhatsApp preparado para ofertas, horários, consulta de produtos, setores frescos, trocas e transferência humana. Ele entende menu numérico e linguagem natural, sincroniza as filas automaticamente e não inventa preço ou estoque.

Configuração e homologação: [`docs/BOT-SUPERMERCADO.md`](docs/BOT-SUPERMERCADO.md).

## Operação comercial

Promoções com validade, previsão de entrega, pedidos, histórico e notificação de despacho usam estruturas multiempresa com RLS. Consulte o guia de configuração, homologação, deploy e rollback em [`docs/OPERACAO-COMERCIAL-2026-07-29.md`](docs/OPERACAO-COMERCIAL-2026-07-29.md).

## Painel master e produção

- `/mavo`: painel administrativo master com login isolado, saúde do Supabase, integrações, indicadores, filas, usuários, horários, configuração do Mavo e auditoria.
- `/api/health`: health check da aplicação, banco, Redis e estado sanitizado do
  canal WhatsApp para o Render.
- `render.yaml`: Blueprint de produção com secrets e variáveis necessárias.

Guia completo: [`docs/DEPLOY-SUPABASE-RENDER.md`](docs/DEPLOY-SUPABASE-RENDER.md).

## Stack atual

- Next.js 16 + TypeScript
- Supabase PostgreSQL como banco oficial
- React 19 + Vite na SPA principal em `frontend/`
- WhatsApp por provider configuravel:
  - `unofficial` via Baileys (QR Code e auth state cifrado no Supabase)
  - `twilio` via webhook
- Cloudinary (midias imagem/documento)
- Socket.IO (tempo real)
- BullMQ + Redis (jobs assincronos)

## Configuracao

1. Copie `.env.example` para `.env` e ajuste variaveis.
2. Instale dependencias:

```bash
npm ci
npm --prefix frontend ci
```

3. Aplique e verifique as migrations versionadas no Supabase/PostgreSQL:

```bash
npm run db:migrate:status
npm run db:migrate
npm run db:verify
```

4. Opcionalmente, em desenvolvimento, rode o seed protegido:

```bash
NODE_ENV=development npm run db:seed:development
```

5. Rode API e SPA em terminais separados:

```bash
npm run dev
cd frontend && npm run dev
```

API: `http://localhost:4002`. A URL da SPA é exibida pelo Vite.

Exemplo de conexao local no `.env`:

```env
DB_PROVIDER=supabase
DATABASE_URL_RUNTIME=postgresql://postgres:SUA_SENHA@localhost:5433/mavo_talk
DATABASE_URL_MIGRATIONS=postgresql://postgres:SUA_SENHA@localhost:5433/mavo_talk
PG_SSL=false
DEFAULT_ORG_ID=org_mavo_talk_default
```

Em produção, use projetos Supabase separados por ambiente e os serviços
descritos em [`docs/deployment-business-cloud.md`](docs/deployment-business-cloud.md).

## Endpoints principais

- `POST /api/webhooks/twilio`
- `POST /api/webhooks/cerebro/reply`
- `POST /api/webhooks/n8n/ticket-upsert`
- `GET /api/whatsapp/status`
- `POST /api/whatsapp/connect`
- `POST /api/whatsapp/disconnect`
- `POST /api/conversations/:id/assign`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/close`
- `GET /api/queues`
- `POST /api/queues`
- `PATCH /api/queues/:id`
- `POST /api/queues/supermarket-preset`
- `GET /api/dashboard/metrics`
- `GET /api/conversations?status=aguardando`

## Webhook de saída (integrações externas)

O Mavo Talk pode enviar eventos para uma URL externa (ex: n8n) quando ticket/mensagem mudam.

Variáveis de ambiente:

- `WILLTALK_WEBHOOK_URL` URL de destino (ex: webhook trigger do n8n)
- `WILLTALK_WEBHOOK_TOKEN` token enviado em `Authorization: Bearer ...`
- `WILLTALK_WEBHOOK_EVENTS` lista CSV de eventos (default: `ticket_created,ticket_updated,message_received,message_sent`)
- `WILLTALK_WEBHOOK_MAX_CHARS` limite do campo `mensagens` consolidado (default: `12000`)
- `WILLTALK_WEBHOOK_ATTEMPTS` tentativas de envio (default: `3`)
- `WILLTALK_WEBHOOK_TIMEOUT_MS` timeout por tentativa em ms (default: `8000`)

Formato enviado:

```json
{
  "ticket_id": "WT-12345",
  "cliente": "Nome do cliente",
  "canal": "whatsapp",
  "mensagens": "texto consolidado",
  "tecnico": "Nome do atendente",
  "data_evento": "2026-03-26T18:30:00.000Z"
}
```

## Webhook de entrada n8n (bot-first / Cérebro v3)

Com `WILLTALK_N8N_ONLY=true`:

- **WhatsApp não oficial (Baileys)**: cada mensagem inbound chama internamente `POST /api/webhooks/n8n/ticket-upsert` (loopback) com Bearer `WILLTALK_WEBHOOK_TOKEN`. A triagem e as respostas ao cliente saem desta rota.
- **Twilio**: no mesmo modo, o webhook Twilio não devolve TwiML de menu; também delega ao `ticket-upsert` (respostas vão pelo canal configurado em `WHATSAPP_PROVIDER` dentro do Mavo Talk).

Rota usada (também pode ser chamada pelo n8n com o mesmo contrato):

- `POST /api/webhooks/n8n/ticket-upsert`

Variável opcional: `WILLTALK_INTERNAL_HOST` (default `127.0.0.1`) para o loopback em Docker.

## Alinhamento Cérebro Operacional

### n8n: path do Webhook (obrigatório para não dar 404)

O Mavo Talk chama `WILLTALK_WEBHOOK_URL` (padrão `http://127.0.0.1:5678/webhook/willtalk-ingestao`). No primeiro node **Webhook** do workflow:

1. **HTTP Method**: `POST`
2. **Path**: `willtalk-ingestao` (somente o slug — sem `/webhook/` no campo Path)
3. Clique em **Listen for test event** uma vez ou **Save**, depois **Active** no workflow (só workflow ativo registra a URL de produção)
4. Teste: `powershell -File scripts/verify-n8n-webhook.ps1` (deve ser HTTP 200, não 404)

Se o path no n8n for outro (ex. UUID automático), ou você altera o Path no node para `willtalk-ingestao`, ou você define `WILLTALK_WEBHOOK_URL` com o mesmo path que o n8n mostra em **Production URL**.

- **Saída Mavo Talk → n8n**: `WILLTALK_WEBHOOK_URL` (ex.: trigger `willtalk-ingestao`) para o n8n ingerir eventos no Cérebro (`POST /api/ingestao/willtalk` na API do Cérebro).
- **Entrada Cérebro → Mavo Talk**: `POST /api/webhooks/cerebro/reply` com `Authorization: Bearer <WILLTALK_WEBHOOK_TOKEN>` e `origem` igual a `WILLTALK_AUTO_REPLY_SOURCE` (default `cerebro-operacional`).
- **Referência da API do Cérebro** (para nodes HTTP no n8n): `CEREBRO_BASE_URL` (ex.: `http://127.0.0.1:3000`).

Documentação detalhada: `docs/integracao-mavo-cerebro-operacional.md` e `docs/integracao-cerebro-reply.md`.

Headers obrigatórios:

- `Authorization: Bearer <WILLTALK_WEBHOOK_TOKEN>`
- `Content-Type: application/json`

Payload:

```json
{
  "event_id": "evt-123",
  "canal": "whatsapp",
  "cliente": {
    "nome": "Nome Cliente",
    "telefone": "5511999999999"
  },
  "mensagem": "Texto inicial do cliente via bot",
  "queue_id": "opcional",
  "prioridade": "baixa",
  "ticket_ref": "opcional",
  "metadata": {
    "origem_fluxo": "n8n-onboarding-v1"
  }
}
```

Exemplo PowerShell:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:4002/api/webhooks/n8n/ticket-upsert" `
  -Headers @{ Authorization = "Bearer trocar_token_forte" } `
  -ContentType "application/json" `
  -Body '{"event_id":"evt-001","canal":"whatsapp","cliente":{"nome":"Cliente Teste","telefone":"5511999999999"},"mensagem":"Preciso abrir chamado","metadata":{"origem_fluxo":"n8n-onboarding-v1"}}'
```

Script local `test-n8n-ticket-upsert.bat`: pergunta mensagem, telefone e nome, e agora permite escolher:
- `1` teste direto no `ticket-upsert` local
- `2` teste via webhook do n8n (`WILLTALK_WEBHOOK_URL` no `.env`)

Para testar sem WhatsApp conectado (sem QR/Twilio), use:

```env
WILLTALK_DRY_RUN_WHATSAPP=true
```

Nesse modo, respostas automáticas são **simuladas** (persistidas no histórico como outbound) sem envio real ao canal.

O **mesmo telefone** reutiliza a **mesma conversa**. Se a triagem já terminou (`triageCompleted: true`, por exemplo após 3 opções inválidas), novas chamadas ao endpoint retornam `shouldReply: false` e **não** há menu — use **outro número** no teste ou reabra a triagem no banco/painel.

## Fluxo de triagem

1. Mensagem inbound cria/atualiza conversa em `Aguardando`.
2. Bot envia menu numerico com demandas ativas.
3. Opcao valida classifica fila e cor do card.
4. Opcao invalida repete menu; apos 3 tentativas envia para humano.

## Cloudinary

Quando chega midia (Twilio ou WhatsApp QR), o sistema tenta fazer upload no Cloudinary e salva `secure_url`.
Se o upload falhar, segue com fallback.

## Modo QR Code (nao oficial)

1. Em `.env`, defina `WHATSAPP_PROVIDER=\"unofficial\"`.
2. Acesse o dashboard e use o bloco `WhatsApp QR`.
3. Clique em `Gerar QR` e escaneie no WhatsApp do celular.
4. Com status `ready`, mensagens entram na fila automaticamente.

## Worker

Para processar filas assicronas:

```bash
npm run worker
```
