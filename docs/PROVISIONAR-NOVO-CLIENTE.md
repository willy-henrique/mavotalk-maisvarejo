# Provisionar um novo estabelecimento (instância dedicada)

Runbook para colocar o Mavo Talk em um cliente novo, com **WhatsApp próprio,
projeto Supabase próprio e workspace Render próprio**. Complementa
[DEPLOY-SUPABASE-RENDER.md](DEPLOY-SUPABASE-RENDER.md), que descreve o deploy em
si; aqui está só o que muda por cliente.

## Por que uma instância nova, e não uma organização nova

O banco é multi-tenant (`organization_id` + RLS em todas as tabelas), mas o
**processo não é**: cada instância roda uma única sessão de WhatsApp
(`WHATSAPP_SESSION_NAME`) e resolve tudo contra um único `DEFAULT_ORG_ID`
(`lib/mavo-organization-scope.ts`). Dois números de WhatsApp exigem dois
processos. Enquanto isso não mudar no código, **um cliente = uma instância**.

E no plano gratuito são 750 horas-instância por mês por workspace, contra ~730
horas de um mês. **Um serviço web acordado 24/7 já consome a cota inteira** — por
isso o cliente novo precisa do próprio workspace/conta no Render, não de mais um
serviço no workspace atual.

> Confirme na aba de billing do Render se a cota gratuita é contada por workspace
> ou por login, e se o plano free permite um segundo Key Value. Se for por login,
> a saída é conta separada (verifique os termos do Render) ou plano pago.

## 0. Insumos que você precisa ter em mãos antes de começar

- [ ] Chip/número de WhatsApp **exclusivo** do cliente (o QR será lido nele)
- [ ] Razão social / nome fantasia, endereço, telefone, link do Google Maps
- [ ] Horário de funcionamento (dias de semana, sábado, domingo)
- [ ] Lista de filas/setores do atendimento e quem responde cada uma
- [ ] E-mail e senha forte para o login master (`/mavo`)
- [ ] Gerenciador de senhas aberto: nada disso vai para o repositório

## 1. Supabase — projeto novo

1. Novo projeto em **East US (North Virginia) / us-east-1** (mesma região do Render).
2. Senha forte do banco — o Supabase mostra uma vez só.
3. **Enable Data API desmarcado.** O backend fala Postgres direto via `pg`.
4. Copie a connection string do **Session pooler** (porta 5432).
5. As migrations rodam sozinhas no `buildCommand` do Render; não precisa rodar nada à mão.

## 2. Render — workspace novo

1. Crie o workspace/conta e conecte o GitHub, autorizando o repositório privado `willy-henrique/willtalk`.
2. **New → Blueprint** apontando para o repositório.
3. Os nomes de serviço (`mavo-talk-api`, `mavo-talk-web`, `mavo-talk-key-value`)
   não colidem entre workspaces, mas **o hostname `.onrender.com` é global**: como
   `mavo-talk-api.onrender.com` já é do cliente atual, o Render vai gerar uma URL
   com sufixo. Anote a URL real assim que o serviço for criado — ela é usada em
   quatro variáveis.

## 3. Ajuste obrigatório no `render.yaml` (única mudança de código)

Hoje duas variáveis têm valor fixo apontando para a instância atual:

```yaml
- key: MAVO_API_PUBLIC_URL
  value: https://mavo-talk-api.onrender.com
- key: TWILIO_WEBHOOK_BASE_URL
  value: https://mavo-talk-api.onrender.com
```

Em qualquer instância nova esses valores ficam **errados** e o Blueprint os
sobrescreve a cada sync, então editar só pelo painel não resolve. Troque as duas
por `sync: false` e preencha em cada ambiente. Depois de mudar, confira no painel
do cliente atual se o valor antigo continuou preenchido.

## 4. Variáveis por cliente

**Nunca copie do cliente atual** (são identidade ou segredo da instância):

| Variável | Origem |
| --- | --- |
| `DATABASE_URL_RUNTIME` / `DATABASE_URL_MIGRATIONS` | Session pooler do Supabase novo |
| `DEFAULT_ORG_ID` | Novo, ex. `org_<cliente>` |
| `WILLTALK_WEBHOOK_ORGANIZATION_ID` | Igual ao `DEFAULT_ORG_ID` |
| `JWT_SECRET`, `WILLTALK_WEBHOOK_TOKEN`, `WHATSAPP_AUTH_ENCRYPTION_KEY` | `generateValue` — deixe o Render gerar |
| `MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `MAVO_MASTER_EMAIL` / `MAVO_MASTER_PASSWORD` | Login master do cliente |
| `WHATSAPP_SESSION_NAME` | Novo, ex. `mavo-talk-<cliente>` |
| `MAVO_API_PUBLIC_URL`, `TWILIO_WEBHOOK_BASE_URL`, `FRONTEND_URL`, `MAVO_ALLOWED_ORIGINS` | URLs reais dos serviços novos |
| `VITE_API_BASE_URL` / `VITE_SOCKET_URL` (no static) | URL da API nova |
| `SUPERMARKET_*` e `BUSINESS_HOURS_*` | Dados reais do estabelecimento |

`WHATSAPP_AUTH_ENCRYPTION_KEY` cifra a sessão do WhatsApp gravada no banco.
Reaproveitar a chave de outro cliente cruza o raio de comprometimento das duas
operações — gere sempre uma nova.

**Podem ser compartilhadas, com ressalva:**

- `CLOUDINARY_*` — a mídia dos dois clientes cai na mesma cloud. Prefira cloud ou
  pasta separada; e a rotação do secret exposto continua pendente.
- `MAVO_AI_BASE_URL` / `MAVO_AI_TOKEN` — Cérebro Operacional, se o cliente usar.
- `MAVO_METRICS_TOKEN` / `MAVO_MANAGEMENT_URL` — só se o cliente for receber o
  painel Mavo Gerenciamento; o token deve ser por cliente.

## 5. Filas: cadastre ANTES do primeiro atendimento

`SUPERMARKET_AUTO_APPLY_PRESET` vem `true` e, na **primeira mensagem** que chegar
com a organização sem nenhuma fila, o sistema aplica o preset de supermercado —
"Ofertas e promoções", "Açougue, padaria e hortifruti" etc. Para um cliente que
não é supermercado isso polui a operação logo na estreia.

Escolha um dos dois, antes de conectar o WhatsApp:

- cadastrar as filas reais do cliente pelo painel (o preset só entra quando não há nenhuma); ou
- `SUPERMARKET_AUTO_APPLY_PRESET=false` (e `SUPERMARKET_BOT_ENABLED=false` se o cliente não vai usar o bot de autoatendimento).

Atenção: as opções de menu **1, 2 e 6 são filas protegidas** e não podem ser
excluídas (`isProtectedSystemQueue`). Dá para renomear, não para remover.

## 6. Seed: não use o de desenvolvimento

`npm run db:seed:development` cria organização fictícia e **30 dias de vendas
falsas**, e é bloqueado com `NODE_ENV=production`. Para cliente real o caminho é:

1. `db:bootstrap:production` cria a organização — já roda no `buildCommand`;
2. entrar em `/mavo` com o login master e cadastrar filas e usuários da equipe pelo painel.

## 7. Checklist de entrada em produção

- [ ] `/api/health` respondendo OK na URL nova
- [ ] Login master funcionando em `/mavo`
- [ ] Filas reais cadastradas e usuários da equipe criados
- [ ] QR lido no número do cliente; sessão persistida (reinicie o serviço e confirme que não pede QR de novo)
- [ ] Keep-alive externo (UptimeRobot / cron-job.org) batendo a cada 10 min na URL nova — sem ele o serviço hiberna em 15 min e o bot cai
- [ ] Teste ponta a ponta: mensagem real de um celular → conversa aparece na caixa de entrada → resposta chega no WhatsApp
- [ ] Credenciais registradas no gerenciador de senhas; nada commitado

## 8. Combinados que o cliente precisa saber antes de assinar

No plano gratuito: hibernação de 15 min (mitigada pelo keep-alive, não eliminada),
~1 min para acordar, fila de jobs best-effort (Key Value sem persistência) e sem
SLA de disponibilidade. Prometa apenas isso.
