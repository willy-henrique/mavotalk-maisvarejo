# Produção com Supabase + Render (plano gratuito)

Este guia publica o Mavo Talk como Web Service Node.js no Render usando o PostgreSQL gerenciado do Supabase. O `render.yaml` contém o Blueprint e `/api/health` valida aplicação e banco.

O Blueprint atual usa **exclusivamente instâncias gratuitas**. Leia a seção de limites antes de prometer disponibilidade a um cliente.

## 0. Limites reais do plano gratuito

| Recurso | Situação no free |
| --- | --- |
| Web Service | Existe, mas **hiberna após 15 min sem tráfego** e leva ~1 min para acordar |
| Disco persistente | **Não existe.** Qualquer arquivo gravado some no restart |
| Background Worker | **Não tem plano gratuito.** As filas rodam dentro do processo web |
| Key Value (Redis) | Existe, mas **sem persistência**. A fila é best-effort |
| `preDeployCommand` | **Só em plano pago.** As migrations rodam no `buildCommand` |
| Memória | ~512 MB por instância |

Consequências que você precisa aceitar:

1. **O processo do WhatsApp para durante restart/hibernação**, mas a sessão não
   é perdida: o Blueprint usa `WHATSAPP_AUTH_STORE=database`, cifra o auth state
   com AES-256-GCM e o persiste no Supabase. O QR só precisa ser lido novamente
   quando a sessão é revogada/deslogada.
2. **A hibernação derruba o bot.** Um bot de WhatsApp precisa estar sempre no ar. Veja a seção 7 para o keep-alive.
3. Jobs enfileirados podem ser perdidos quando o Key Value reinicia. Hoje só `media-cleanup` faz trabalho real (remoção no Cloudinary); os demais são de observabilidade.

Quando houver orçamento, migre a API, o worker e o Key Value para planos pagos
para eliminar hibernação e dar durabilidade às filas. O auth state do WhatsApp
continua no Supabase e não exige disco. O provedor `unofficial` usa Baileys, sem
navegador ou Chromium embutido.

## 1. Criar e preparar o Supabase

1. Crie um projeto no Supabase na região mais próxima do Render (o Blueprint usa `virginia`, então **East US (North Virginia) / us-east-1**).
2. Defina uma senha forte para o banco e **guarde-a**: o Supabase mostra o valor uma única vez e ela faz parte da connection string.
3. Deixe **Enable Data API desmarcado**. O backend fala com o Postgres direto via `pg` (veja `lib/supabase-admin.ts`), então a API REST pública é superfície de ataque sem uso.
4. Em **Connect**, copie a connection string do **Session pooler** (host `pooler.supabase.com`, porta `5432`).
5. Nunca versione essa URL.

As migrations ficam em `supabase/migrations/` e são aplicadas por `npm run db:migrate`, que registra cada arquivo em `mavo_schema_migrations` com checksum. Em seguida, `npm run db:bootstrap:production` garante de forma idempotente a organização indicada por `DEFAULT_ORG_ID`, sem criar ou alterar credenciais de usuários. O schema ativa RLS em todas as tabelas sem criar políticas públicas. O navegador nunca acessa o Supabase diretamente; toda operação passa pelo backend autenticado.

## 2. Criar os serviços no Render

1. Envie o projeto para um repositório privado no GitHub.
2. No Render, escolha **New → Blueprint** e selecione o repositório.
3. O Render detecta o `render.yaml` e cria três recursos: `mavo-talk-api` (web free), `mavo-talk-web` (static) e `mavo-talk-key-value` (Key Value free).
4. Preencha os valores marcados como secretos (seção 3).
5. Confirme e inicie o deploy.

O serviço web usa:

- build: `npm ci && npm run typecheck && npm run build && npm run db:migrate && npm run db:bootstrap:production && npm run db:verify`;
- start: `npm run start`;
- porta: a variável `PORT` fornecida pelo Render;
- health check: `/api/health`;
- WebSocket: o mesmo servidor HTTP, rota `/socket.io`.

As migrations rodam no build porque `preDeployCommand` exige plano pago. Se uma migration falhar, o build falha e a versão antiga continua no ar.

## 3. Variáveis que você precisa preencher

O Blueprint gera sozinho `JWT_SECRET` e `WILLTALK_WEBHOOK_TOKEN`. As marcadas com `sync: false` são suas:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL_RUNTIME` | Session pooler do Supabase |
| `DATABASE_URL_MIGRATIONS` | Mesma connection string (ou a direta, porta 5432) |
| `FRONTEND_URL` | URL do serviço `mavo-talk-web` |
| `MAVO_ALLOWED_ORIGINS` | Mesma URL do frontend, HTTPS completo |
| `DEFAULT_ORG_ID` | Identificador da organização, ex. `org_mavo_talk_default` |
| `WILLTALK_WEBHOOK_ORGANIZATION_ID` | Mesmo valor de `DEFAULT_ORG_ID` |
| `MAVO_MASTER_EMAIL` | Login fixo de `/mavo` |
| `MAVO_MASTER_PASSWORD` | Senha forte do login fixo |
| `MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY` | 32 bytes em base64 — `openssl rand -base64 32` |
| `CLOUDINARY_*` | Credenciais do Cloudinary, se for usar mídia |
| `MAVO_AI_BASE_URL` / `MAVO_AI_TOKEN` | Integração com o Cérebro Operacional, se for usar |

No serviço estático `mavo-talk-web`, preencha `VITE_API_BASE_URL` e `VITE_SOCKET_URL` com a URL do `mavo-talk-api`.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` podem ficar vazias: com `DATABASE_URL_RUNTIME` preenchida, o app usa o shim Postgres e nunca chama a Data API.

O login master é independente da tabela de usuários. A senha existe apenas como secret do Render, nunca é enviada ao frontend e nunca aparece no painel. Opcionalmente use `MAVO_MASTER_PASSWORD_HASH` com um hash bcrypt.

## 4. Dados da loja

```env
SUPERMARKET_NAME=Nome real do supermercado
SUPERMARKET_ADDRESS=Endereço completo
SUPERMARKET_MAPS_URL=https://maps.google.com/...
SUPERMARKET_HOURS_WEEKDAYS=Segunda a sábado: 07h às 21h
SUPERMARKET_HOURS_SUNDAY=Domingos e feriados: 08h às 14h
SUPERMARKET_OFFERS_URL=https://site.com/ofertas
SUPERMARKET_ORDER_URL=https://site.com/pedidos
SUPERMARKET_DELIVERY_INFO=Descrição da área, taxa e prazo de entrega
SUPERMARKET_PHONE=(00) 0000-0000
```

O painel `/mavo` mostra os campos ausentes. Enquanto um dado não estiver configurado, a Mavi encaminha a solicitação para uma pessoa em vez de inventar resposta.

Configure também o calendário usado pela automação para decidir se a equipe está
disponível. O cadastro de horários no banco, quando existir, tem prioridade:

```env
BUSINESS_HOURS_WEEKDAY_START=07:00
BUSINESS_HOURS_WEEKDAY_END=21:00
BUSINESS_HOURS_WEEKDAY_CLOSED=false
BUSINESS_HOURS_SATURDAY_START=07:00
BUSINESS_HOURS_SATURDAY_END=21:00
BUSINESS_HOURS_SATURDAY_CLOSED=false
BUSINESS_HOURS_SUNDAY_START=08:00
BUSINESS_HOURS_SUNDAY_END=14:00
BUSINESS_HOURS_SUNDAY_CLOSED=false
```

Para fechar um grupo de dias, use `true` no respectivo campo `*_CLOSED`. Um dia
marcado como inativo no cadastro do banco nunca cai no horário padrão.

## 5. Seed inicial

O plano gratuito **não dá acesso ao Render Shell**. Rode o seed da sua máquina, apontando para o Supabase:

```bash
DATABASE_URL_RUNTIME="<session pooler>" npm run db:seed:development
```

O comando é idempotente e cria/atualiza a organização, o administrador da operação e as filas do supermercado.

Depois acesse:

- `https://SEU-DOMINIO/mavo` — painel master;
- `https://SEU-DOMINIO/login` — atendimento operacional;
- `https://SEU-DOMINIO/api/health` — saúde usada pelo Render.

## 6. WhatsApp em produção

### Twilio

Opção mais estável no plano gratuito: é baseada em webhook, não exige processo sempre vivo nem disco. Defina `WHATSAPP_PROVIDER=twilio`, configure as credenciais e aponte o webhook para:

```text
https://SEU-DOMINIO/api/webhooks/twilio
```

A primeira mensagem após a hibernação sofre o atraso do cold start (~1 min).

### WhatsApp por QR Code (Baileys)

É o padrão do Blueprint (`unofficial`), implementado com Baileys e sem
Chromium. A sessão é persistida na tabela `whatsapp_auth_state`, isolada por
organização e nome de sessão. Todos os valores são cifrados na aplicação antes
de chegar ao banco. `WHATSAPP_AUTH_ENCRYPTION_KEY` é gerada pelo Blueprint e
nunca deve ser trocada ou removida enquanto existir uma sessão ativa. Durante
a primeira sincronização do Blueprint, o backend também aceita uma subchave
separada derivada do `JWT_SECRET`; isso evita cair em filesystem efêmero se a
variável nova ainda não tiver sido aplicada pelo Render.

Se o WhatsApp desconectar por queda de rede ou restart, o serviço tenta
reconectar usando as credenciais do Supabase. Se a sessão for deslogada de fato
(por exemplo, removida pelo celular), o estado inválido é apagado e o painel
passa a exigir um novo QR.

Como `sendTriageMessageToWhatsApp` tenta o `unofficial` primeiro e cai para o Twilio automaticamente se não estiver pronto, vale configurar as duas credenciais (Baileys conectado pelo QR + Twilio configurado) para ter redundância sem custo extra.

## 7. Evitar a hibernação

O plano gratuito dá 750 horas-instância por mês e um mês tem ~730 horas, então **um único serviço web pode ficar acordado 24/7 dentro da cota**. Configure um monitor externo gratuito (UptimeRobot, cron-job.org) chamando a cada 10 minutos:

```text
https://SEU-DOMINIO/api/health
```

Isso não elimina a breve indisponibilidade de um restart, mas a sessão do
WhatsApp permanece cifrada no Supabase.

## 8. Checklist de entrada em produção

- `/api/health` retorna HTTP 200 e banco `online`;
- `/mavo` aceita apenas a credencial master do Render;
- login operacional funciona com a conta criada no seed;
- painel mostra Supabase online e sem campos pendentes da loja;
- menu do bot possui as filas corretas;
- mensagem de teste entra, recebe resposta e aparece no atendimento;
- webhook usa HTTPS e token forte;
- `WILLTALK_DRY_RUN_WHATSAPP=false`;
- keep-alive externo configurado;
- secrets não estão no repositório nem em logs;
- domínio personalizado e TLS ativos antes da divulgação.

## 9. Diagnóstico rápido

- **Health 503 / banco offline:** revise `DATABASE_URL_RUNTIME`, senha, host do pooler e `PG_SSL=true`.
- **Build falha em `db:migrate`:** confira `DATABASE_URL_MIGRATIONS`. Migration já aplicada e alterada também aborta — crie uma migration nova em vez de editar a antiga.
- **Boot falha com `WHATSAPP_AUTH_ENCRYPTION_KEY`:** mantenha
  `WHATSAPP_AUTH_STORE=database` e uma chave com pelo menos 32 caracteres. Não
  gere outra chave sobre dados já persistidos.
- **Tabela `whatsapp_auth_state` ausente:** confirme que
  `npm run db:migrate` aplicou `202607240006_whatsapp_auth_state.sql`.
- **WhatsApp não reconecta sozinho após ficar `disconnected`:** confira o `lastError` em `/api/whatsapp/status` — se a sessão foi deslogada (`loggedOut`), é preciso ler um novo QR pelo painel; qualquer outro motivo tenta reconectar automaticamente em poucos segundos.
- **Primeira requisição do dia demora ~1 min:** hibernação. Veja a seção 7.
- **Login master não configurado:** preencha `MAVO_MASTER_EMAIL`, `MAVO_MASTER_PASSWORD` e `JWT_SECRET`, depois faça redeploy.
- **Bot transfere ofertas/horários para humano:** complete os campos `SUPERMARKET_*` indicados no `/mavo`.

Referências: [conexões PostgreSQL do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [instâncias gratuitas do Render](https://render.com/docs/free), [Web Services](https://render.com/docs/web-services), [health checks](https://render.com/docs/health-checks), [WebSockets](https://render.com/docs/websocket).
