# Instância Mais Varejo

Fork dedicado do Mavo Talk para o cliente **Mais Varejo** (empresa de suporte a
sistema — **não** é supermercado). Um cliente = uma instância: WhatsApp,
projeto Supabase e workspace Render próprios. O runbook genérico continua em
[PROVISIONAR-NOVO-CLIENTE.md](PROVISIONAR-NOVO-CLIENTE.md); aqui está o estado
real desta cópia e o que ainda falta.

## Identidade desta instância

| Item | Valor |
| --- | --- |
| Pasta local | `C:\willydev\mavotalk-maisvarejo` |
| Repositório (`origin`) | `willy-henrique/mavotalk-maisvarejo` |
| Produto base (`upstream`) | `willy-henrique/willtalk` |
| Workspace Render | `mavotalk-maisvarejo` |
| Serviço API | `mavotalk-maisvarejo-api` |
| Serviço painel (static) | `mavotalk-maisvarejo-web` |
| Key Value | `mavotalk-maisvarejo-key-value` |
| `DEFAULT_ORG_ID` | `org_maisvarejo` |
| `WHATSAPP_SESSION_NAME` | `mavotalk-maisvarejo` |

## O que já está configurado

- `render.yaml` com os três serviços renomeados, `fromService` do Key Value
  apontando para o Key Value novo e `PG_APPLICATION_NAME` próprio.
- As seis variáveis de URL preenchidas com os hostnames previstos
  (`MAVO_API_PUBLIC_URL`, `TWILIO_WEBHOOK_BASE_URL`, `FRONTEND_URL`,
  `MAVO_ALLOWED_ORIGINS`, `VITE_API_BASE_URL`, `VITE_SOCKET_URL`).
- `DEFAULT_ORG_ID` e `WILLTALK_WEBHOOK_ORGANIZATION_ID` fixados no Blueprint com
  o mesmo valor — os dois precisam bater, e fixar evita divergência por digitação.
- **Bot de supermercado desligado**: `SUPERMARKET_BOT_ENABLED=false` e
  `SUPERMARKET_AUTO_APPLY_PRESET=false`. Sem isso, a primeira mensagem recebida
  criaria as filas de supermercado ("Ofertas e promoções", "Açougue, padaria e
  hortifruti"…) numa operação de suporte.
- `.env` local gerado com segredos **novos** (`JWT_SECRET`,
  `WHATSAPP_AUTH_ENCRYPTION_KEY`, `WILLTALK_WEBHOOK_TOKEN`,
  `MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY`). Nenhum segredo do cliente anterior
  foi copiado; a sessão de WhatsApp do willtalk também ficou de fora.
- Dependências instaladas (raiz e `frontend/`) com binários win32.

> O hostname `.onrender.com` é global. Se o Render gerar sufixo em algum serviço,
> corrija as seis variáveis de URL no `render.yaml` antes do primeiro deploy.

## Infraestrutura provisionada (31/08/2026)

**Render** — workspace `mavotalk-maisvarejo`, Blueprint de mesmo nome sincronizando
o `main`. Os três serviços existem, em plano free:

| Serviço | Região | URL |
| --- | --- | --- |
| `mavotalk-maisvarejo-api` | Virginia | https://mavotalk-maisvarejo-api.onrender.com |
| `mavotalk-maisvarejo-web` | Global (CDN) | https://mavotalk-maisvarejo-web.onrender.com |
| `mavotalk-maisvarejo-key-value` | Virginia | interno, via `fromService` |

Os hostnames saíram sem sufixo, então as seis URLs fixadas no `render.yaml` estão
corretas. A cota free é **por workspace** (750 h), confirmada na aba de billing.

**Supabase** — projeto `azqxothepfxacafdmjoy` (nome `mavotalk-maisvarejo`),
org `mavotalk-maisvarejo`, plano free, us-east-2.

```
DATABASE_URL_RUNTIME    = postgresql://postgres.azqxothepfxacafdmjoy:<SENHA>@aws-0-us-east-2.pooler.supabase.com:5432/postgres
DATABASE_URL_MIGRATIONS = (o mesmo)
PG_SSL                  = true
```

Host confirmado no painel em 31/08/2026. É o **Session pooler**: a conexão
direta (`db.<ref>.supabase.co`) é IPv6 e a Render não alcança, e o Transaction
pooler não mantém sessão, que as migrations exigem.

É o **Session pooler**, porta 5432. A conexão direta (`db.<ref>.supabase.co`) é
IPv6 e a Render não alcança; o pooler é proxiado em IPv4. Não troque por
Transaction pooler: as migrations usam sessão.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` **não precisam
ser preenchidas.** `lib/supabase-admin.ts` cai no shim sobre Postgres sempre que
`DATABASE_URL_RUNTIME` existe, e só `scripts/seed-supabase.mjs` (dev) usa o cliente
REST. Deixar a service_role fora do painel do Render reduz o raio de exposição.

### Divergência de região, aceita conscientemente

O Supabase está em **us-east-2 (Ohio)** e a Render em **Virginia (us-east-1)**.
Região no Supabase é imutável e os serviços da Render já estavam criados com os
hostnames certos, então recriar qualquer um dos lados custava mais do que o
problema: são ~10-12 ms por query, imperceptíveis num plano free que já hiberna
15 min e leva ~50 s para acordar. **Isto é uma decisão, não um bug** — não
"corrija" recriando o projeto sem antes reler este parágrafo.

## O que falta

1. **Preencher no painel do Render** (nenhuma delas passa por este repositório):
   - `DATABASE_URL_RUNTIME` e `DATABASE_URL_MIGRATIONS` — a string acima com a
     senha real do banco. Se a senha tiver caractere especial, faça percent-encode.
   - `MAVO_MASTER_EMAIL` e `MAVO_MASTER_PASSWORD` — login master de `/mavo`.
   - `MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY` — **nao e mais necessaria**: a API
     do agente cloud esta desligada (`MAVO_AGENT_API_ENABLED=false`), e o
     validador de boot so exige a chave quando ela esta ligada.
   - Conforme o uso: `CLOUDINARY_*`, `TWILIO_*`, `MAVO_AI_*`,
     `MAVO_METRICS_TOKEN` / `MAVO_MANAGEMENT_URL`.
   - `SUPERMARKET_*`: deixe em branco, o bot está desligado.
   - `JWT_SECRET`, `WHATSAPP_AUTH_ENCRYPTION_KEY` e `WILLTALK_WEBHOOK_TOKEN` o
     Render já gerou (`generateValue`). Não cole os do willtalk.
2. **Redeployar a API.** O primeiro build falhou só em `db:migrate` por falta de
   `DATABASE_URL_MIGRATIONS`; `npm ci` e `next build` já passam.
3. **Data API do Supabase** ainda ligada — o passo 3 do runbook pede desligar.
4. **Cadastrar as filas reais do suporte** em `/mavo` antes de conectar o WhatsApp.
   As opções de menu **1, 2 e 6 são filas protegidas** (`isProtectedSystemQueue`):
   dá para renomear, não para excluir.
5. **Ler o QR** no número exclusivo do cliente e reiniciar o serviço para
   confirmar que a sessão persistiu no banco.
6. **Keep-alive externo** (UptimeRobot / cron-job.org) a cada 10 min na URL da API
   — sem ele o serviço free hiberna em 15 min e o bot cai.

## Rodar local

```bash
npm run dev          # API + painel master em http://localhost:4002
npm --prefix frontend run dev   # painel de atendimento em http://localhost:4001
npm run typecheck
npm run render:validate
```

O `.env` já está preenchido, menos as conexões de banco e o login master —
o cabeçalho do arquivo lista exatamente o que falta. `WHATSAPP_AUTO_CONNECT` vem
`false` e `WILLTALK_DRY_RUN_WHATSAPP` vem `true` em dev: nada é enviado para o
WhatsApp real por acidente.

## Trazer melhorias do produto base

O histórico do willtalk foi preservado, então correções feitas no produto base
entram aqui por merge:

```bash
git fetch upstream
git merge upstream/main
```

Conflito esperado só em `render.yaml` (nomes de serviço e URLs) — mantenha os
valores desta instância.

## Roadmap: fila com webhook (integração Mavo AI)

A automação de fila já é um ponto de extensão fechado por tipo. Hoje
`QUEUE_AUTOMATION_TYPES` (em [`lib/queue-automation-schemas.ts`](../lib/queue-automation-schemas.ts))
vale `custom`, `offers_promotions` e `business_hours_location`. Uma fila que
delega a resposta a um webhook — Mavo AI ou qualquer outro sistema — entra como
um quarto tipo, sem tocar no motor de atendimento:

1. `lib/queue-automation-schemas.ts`: adicionar `"webhook"` ao enum e um
   `webhookAutomationConfigSchema` estendendo `commonAutomationSchema` (URL
   https, timeout, segredo de assinatura, o que fazer quando o webhook falha ou
   demora — cair para humano é o padrão seguro).
2. `lib/queue-automation-runtime.ts`: tratar o novo tipo no despacho.
3. `lib/queue-automation.ts`: persistência e validação da configuração.
4. Painel `/mavo`: formulário do novo tipo de fila.

Já existe entrega por webhook global em
[`lib/willtalk-webhook.ts`](../lib/willtalk-webhook.ts) (assinatura, retentativas
e recorte de payload) e cliente do Cérebro em
[`lib/cerebro-orchestrator-client.ts`](../lib/cerebro-orchestrator-client.ts) —
reaproveite o transporte em vez de escrever outro. Para a Mavo AI, as variáveis
`MAVO_AI_BASE_URL` e `MAVO_AI_TOKEN` já estão no Blueprint como `sync: false`.

Como a mudança é no produto e não no cliente, o lugar natural dela é o
`upstream` (willtalk), descendo para cá pelo merge acima. Se for feita direto
aqui, vale abrir o PR correspondente no repositório base depois.
