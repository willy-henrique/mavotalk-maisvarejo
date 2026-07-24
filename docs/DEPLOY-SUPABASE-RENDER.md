# Produção com Supabase + Render

Este guia publica o Mavo Talk como um Web Service Node.js no Render, usando o PostgreSQL gerenciado do Supabase. O arquivo `render.yaml` já contém o Blueprint base e o endpoint `/api/health` valida aplicação e banco.

## 1. Criar e preparar o Supabase

1. Crie um projeto no Supabase em uma região próxima do serviço do Render.
2. Abra **SQL Editor → New query**.
3. Cole e execute todo o conteúdo de `scripts/supabase-schema.sql`.
4. No botão **Connect**, copie a conexão **Session pooler**. Ela normalmente usa host `pooler.supabase.com` e porta `5432`.
5. Guarde a conexão completa como `DATABASE_URL`. Não coloque essa URL no Git.

Para o backend persistente do Render, o Session pooler é uma opção segura quando a rede exige IPv4. Use `PG_SSL=true`.

O schema ativa RLS em todas as tabelas sem criar políticas públicas. O navegador nunca acessa o Supabase diretamente; toda operação passa pelo backend autenticado do Mavo Talk.

## 2. Criar o serviço no Render

1. Envie o projeto para um repositório privado no GitHub, GitLab ou Bitbucket.
2. No Render, escolha **New → Blueprint** e selecione o repositório.
3. O Render detectará `render.yaml`.
4. Preencha todos os valores marcados como secretos.
5. Confirme o plano e inicie o deploy.

O serviço usa:

- build: `npm ci && npm run build`;
- start: `npm start`;
- porta: a variável `PORT` fornecida automaticamente pelo Render;
- health check: `/api/health`;
- WebSocket: o mesmo servidor HTTP e a rota `/socket.io`.

## 3. Secrets obrigatórios

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Session pooler do Supabase |
| `JWT_SECRET` | Gerada automaticamente pelo Blueprint |
| `MAVO_MASTER_EMAIL` | Login fixo de `/mavo` |
| `MAVO_MASTER_PASSWORD` | Senha forte do login fixo |
| `SEED_ADMIN_EMAIL` | Conta administrativa da operação |
| `SEED_ADMIN_PASSWORD` | Senha inicial/atualizada da operação |
| `WHATSAPP_PROVIDER` | `twilio` ou `unofficial` |
| `WILLTALK_WEBHOOK_TOKEN` | Gerado automaticamente para autenticar webhooks |

O login master é independente da tabela de usuários. Sua senha existe apenas como secret do Render, nunca é enviada ao frontend e nunca aparece no painel.

Opcionalmente, substitua `MAVO_MASTER_PASSWORD` por `MAVO_MASTER_PASSWORD_HASH` contendo um hash bcrypt.

## 4. Dados da loja

Preencha no ambiente do Render:

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

O painel `/mavo` mostra os campos ausentes. Enquanto um dado não estiver configurado, a Mavi encaminha a solicitação para uma pessoa em vez de inventar uma resposta.

## 5. Seed inicial

Depois que o primeiro deploy estiver ativo, abra **Render → Shell** e execute:

```bash
npm run seed-postgres
```

Esse comando é idempotente e:

- cria ou atualiza a organização;
- cria ou atualiza o administrador da operação;
- aplica as sete filas do supermercado;
- pausa filas antigas fora do modelo.

Depois acesse:

- `https://SEU-DOMINIO/mavo` — painel master;
- `https://SEU-DOMINIO/login` — atendimento operacional;
- `https://SEU-DOMINIO/api/health` — saúde usada pelo Render.

## 6. WhatsApp em produção

### Twilio

É a opção mais simples para serviços sem disco. Defina `WHATSAPP_PROVIDER=twilio`, configure as credenciais e aponte o webhook do WhatsApp para:

```text
https://SEU-DOMINIO/api/webhooks/twilio
```

### WhatsApp por QR Code

Use `WHATSAPP_PROVIDER=unofficial` somente em uma instância paga com disco persistente. O Render usa filesystem efêmero por padrão; sem disco, a sessão QR desaparece em reinícios e deploys.

Crie um disco de 1 GB com mount path:

```text
/opt/render/project/src/.wwebjs_auth
```

Depois abra o atendimento, conecte o QR e confirme no `/mavo` que o WhatsApp está online. Um serviço com disco fica limitado a uma instância e os deploys têm uma pequena janela de indisponibilidade.

## 7. Checklist de entrada em produção

- `/api/health` retorna HTTP 200 e banco `online`;
- `/mavo` aceita apenas a credencial master do Render;
- login operacional funciona com `SEED_ADMIN_EMAIL`;
- painel mostra Supabase online e sem campos pendentes da loja;
- menu do bot possui sete filas corretas;
- mensagem de teste entra, recebe resposta e aparece no atendimento;
- webhook usa HTTPS e token forte;
- `WILLTALK_DRY_RUN_WHATSAPP=false`;
- secrets não estão no repositório nem em logs;
- domínio personalizado e TLS estão ativos antes da divulgação.

## 8. Diagnóstico rápido

- **Health 503 / banco offline:** revise `DATABASE_URL`, senha, host do pooler e `PG_SSL=true`.
- **Build funciona, mas serviço não abre:** confirme que o start command é `npm start` e que o Render fornece `PORT`.
- **Login master não configurado:** preencha `MAVO_MASTER_EMAIL`, `MAVO_MASTER_PASSWORD` e `JWT_SECRET`, depois faça redeploy.
- **QR desconecta após deploy:** confirme que o disco está montado exatamente em `.wwebjs_auth`.
- **Bot transfere ofertas/horários para humano:** complete os campos `SUPERMARKET_*` indicados no `/mavo`.

Referências oficiais: [conexões PostgreSQL do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [Web Services do Render](https://render.com/docs/web-services), [health checks](https://render.com/docs/health-checks), [WebSockets](https://render.com/docs/websocket) e [discos persistentes](https://render.com/docs/disks).
