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

## O que falta

1. **Criar o repositório** `willy-henrique/mavotalk-maisvarejo` (privado) e
   `git push -u origin main`. O Blueprint do Render precisa de um repo.
2. **Supabase novo**, região `us-east-1`, *Enable Data API* desmarcado.
   Copiar a connection string do **Session pooler** (porta 5432).
3. **Render → New → Blueprint** apontando para o repo novo.
4. **Preencher as variáveis `sync: false`** no painel:
   - Obrigatórias: `DATABASE_URL_RUNTIME`, `DATABASE_URL_MIGRATIONS`,
     `MAVO_MASTER_EMAIL`, `MAVO_MASTER_PASSWORD`,
     `MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY` (`openssl rand -base64 32`).
   - Opcionais conforme o uso: `SUPABASE_*`, `CLOUDINARY_*` (prefira cloud ou
     pasta separada do cliente anterior), `TWILIO_*`, `MAVO_AI_*`,
     `MAVO_METRICS_TOKEN` / `MAVO_MANAGEMENT_URL`.
   - `SUPERMARKET_*`: pode deixar em branco — com o bot desligado não são lidas.
   - `JWT_SECRET`, `WHATSAPP_AUTH_ENCRYPTION_KEY` e `WILLTALK_WEBHOOK_TOKEN` o
     Render gera sozinho (`generateValue`). Não cole os do willtalk.
5. **Cadastrar as filas reais do suporte** pelo painel `/mavo` antes de conectar
   o WhatsApp. As opções de menu **1, 2 e 6 são filas protegidas**
   (`isProtectedSystemQueue`): dá para renomear, não para excluir.
6. **Ler o QR** no número exclusivo do cliente e reiniciar o serviço para
   confirmar que a sessão persistiu no banco.
7. **Keep-alive externo** (UptimeRobot / cron-job.org) a cada 10 min na URL nova
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
