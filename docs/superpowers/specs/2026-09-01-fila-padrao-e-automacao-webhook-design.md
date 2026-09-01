# Fila padrão + automação de fila tipo webhook

**Data:** 2026-09-01
**Status:** aprovado, aguardando plano de implementação
**Repositório:** `mavotalk-maisvarejo` (fork dedicado ao cliente Mais Varejo); candidato a
subir depois para o produto base `willtalk`, por ser funcionalidade de plataforma e não
algo específico deste cliente.

## Contexto

O Mais Varejo é uma empresa de suporte, não um supermercado — o bot de menu numérico
está desligado (`SUPERMARKET_BOT_ENABLED=false`, decisão documentada em
`docs/CLIENTE-MAIS-VAREJO.md`). Isso tem uma consequência que só ficou clara ao rastrear
o código: o motor de automação de fila que já existe
(`QUEUE_AUTOMATION_TYPES = custom | offers_promotions | business_hours_location`, em
[`lib/queue-automation-schemas.ts`](../../../lib/queue-automation-schemas.ts)) só é
disparado a partir de `decideSupermarketBot()`
([`lib/supermarket-bot.ts:428`](../../../lib/supermarket-bot.ts)), que retorna `null`
quando o bot está desligado. Ou seja: **hoje esse motor nunca roda para este cliente**,
apesar de a fila poder ser configurada no painel "Filas e automações".

Existe também um orquestrador de IA por organização inteira
([`lib/cerebro-orchestrator-client.ts`](../../../lib/cerebro-orchestrator-client.ts),
variável `CEREBRO_ORCHESTRATOR_URL`/`MAVO_AI_BASE_URL`, ainda não configurada): ele
recebe toda mensagem nova, decide a fila e a resposta, mas é global — não por fila.

O usuário quer preparar o terreno para uma fila que delega a resposta a um serviço de
IA externo, plugado especificamente naquela fila (não em toda a organização). O alvo
concreto ainda não existe — outra plataforma que a empresa usava (MTalk) está sendo
desligada em favor deste produto, então o contrato do webhook é **nosso**, desenhado do
zero, não uma integração com uma API de terceiro já existente.

## Fora de escopo

- Qualquer integração com o MTalk (`s11.mtalk.com.br`) — está sendo descontinuado.
- Escolher/configurar o endpoint real de IA que vai responder pelo webhook — isso é
  configuração de fila feita pelo usuário depois que a funcionalidade existir, não
  código.
- Mexer no motor de automação existente (`offers_promotions`/`business_hours_location`)
  ou no orquestrador global — ambos continuam como estão.
- Redesenho visual do Inbox (`components/InboxConversations.tsx`) — discussão separada,
  pausada.

## Parte A — Fila padrão para conversa sem fila

### Problema

Hoje, uma conversa sem fila (mensagem nova sem bot para triar, ou devolvida à fila por
um atendente) fica com `queue_id = null`, esperando um humano decidir. Não existe
conceito de "para onde isso vai por padrão".

### Mudança de dados

Nova coluna `organizations.default_queue_id` (nullable, `REFERENCES queues(id)`,
`ON DELETE SET NULL` — se a fila padrão for excluída, o campo volta a vazio em vez de
travar a exclusão ou apontar para uma fila morta).

### Comportamento

Sempre que o fluxo de mensagem em
[`app/api/webhooks/n8n/ticket-upsert/route.ts`](../../../app/api/webhooks/n8n/ticket-upsert/route.ts)
chegaria a deixar `queueId = null` — tanto para conversa nova quanto para uma que
volta sem fila — se a organização tiver `default_queue_id` configurado e essa fila
ainda existir e estiver ativa, usa ela em vez de `null`. Sem fila padrão configurada,
o comportamento de hoje continua idêntico (nada muda por padrão em nenhum cliente
existente).

### Painel

Em "Filas e automações", um seletor "Fila padrão para conversas sem destino" (mesmo
nível hierárquico do bloco "Nome do supermercado e identidade do bot" que já existe na
tela). Lista as filas ativas da organização; opção "Nenhuma" limpa o campo.

## Parte B — Automação de fila tipo `webhook`

### Mudança de schema

Quarto valor em `QUEUE_AUTOMATION_TYPES`: `"webhook"`. Ao contrário de
`offers_promotions`/`business_hours_location`, que são singleton por organização
(checado em [`app/api/queues/route.ts:32`](../../../app/api/queues/route.ts)), o tipo
`webhook` **não** tem essa restrição — nada impede várias filas apontando para
especialidades de IA diferentes no futuro (suporte técnico, financeiro, etc.), e não
há motivo de negócio para impedir isso como existe para "os horários da loja" (só pode
haver um).

Novo `webhookAutomationConfigSchema`, estendendo o `commonAutomationSchema` que as
automações já compartilham (`initialMessage`, `noContentMessage`, `closingMessage`,
`allowHumanHandoff`, `showReturnToMenu`, `useAiFallback`, `enabled`):

```ts
export const webhookAutomationConfigSchema = commonAutomationSchema.extend({
  webhookUrl: httpUrl,               // obrigatório, só http(s)
  webhookSecret: z.string().trim().min(16).max(200), // assina o payload (HMAC)
  timeoutMs: z.number().int().min(2_000).max(25_000).default(15_000),
}).strict();
```

`webhookSecret` nunca é devolvido em claro pelas rotas de leitura do painel (mesmo
padrão de qualquer segredo já tratado no projeto) — só write-only, com indicação de
"configurado" ou não.

### Onde entra no fluxo de mensagem

Em `ticket-upsert/route.ts`, depois de resolver `queueId` (agora já passando pela fila
padrão da Parte A): se a fila atual tiver `queueType === "webhook"` e a automação
estiver `enabled`, e **ninguém tiver assumido o chamado** (`humanHandling` falso — a
mesma variável que já existe e já silencia o bot de supermercado hoje), chama o
webhook. Isso acontece **antes** do bloco `else if (AI_TRIAGE_ONLY)` que invoca o
orquestrador global: uma automação específica da fila tem prioridade sobre a genérica
da organização.

Assim que um atendente clica "Puxar", a automação para de responder — mesmo
mecanismo que já existe para o bot de supermercado, não é preciso inventar um novo.

### Contrato do webhook

Novo módulo `lib/queue-webhook-client.ts` (mesma responsabilidade de
`lib/cerebro-orchestrator-client.ts`, mas por fila em vez de por organização — não
generalizo o arquivo existente em um só, porque os dois formatos de payload são
diferentes o bastante e generalizar cedo demais tende a criar uma abstração errada).

**Requisição** — `POST` para `webhookUrl`, assinado:

```
Content-Type: application/json
X-Mavo-Signature: sha256=<hmac-hex do corpo, chave = webhookSecret>
X-Mavo-Queue-Id: <queueId>
```

```json
{
  "organization_id": "org_maisvarejo",
  "conversation_id": "...",
  "queue_id": "...",
  "cliente": { "nome": "...", "telefone": "..." },
  "mensagem": "texto da última mensagem do cliente",
  "media_url": null,
  "mime_type": null,
  "historico_recente": [{ "direction": "inbound", "text": "...", "at": "ISO" }],
  "event_id": "..."
}
```

`historico_recente` limitado às 10 mensagens mais recentes da conversa — dá contexto
sem mandar o histórico inteiro a cada turno.

**Resposta esperada**, `200`:

```json
{ "reply_text": "texto que vai para o cliente", "handoff": false }
```

`handoff: true` (ou ausência de `reply_text`) devolve a conversa para atendimento
humano imediatamente — a própria automação pode decidir que chegou a hora.

**Timeout:** o valor configurado na fila (padrão 15s, teto 25s). **Sem retry** — ao
contrário do webhook de eventos existente
([`lib/willtalk-webhook.ts`](../../../lib/willtalk-webhook.ts)), que pode reenviar uma
notificação assíncrona sem problema, aqui uma nova tentativa depois de um timeout pode
gerar duas respostas para o mesmo cliente se a primeira só demorou a voltar. Falha ou
timeout → fallback abaixo, sem segunda tentativa automática.

**Validação da URL contra SSRF:** como `webhookUrl` é preenchida por um admin da
organização no painel — não é um valor fixo de infraestrutura — a validação exige
`https://`, resolve o host e recusa IPs privados/loopback/link-local antes de salvar a
configuração (o mesmo cuidado que já existe implicitamente ao aceitar só `https?://`
em `httpUrl`, estendido para checar o destino real e não só a forma da string).

### Falha ou timeout

Se a chamada falhar, der timeout, ou vier sem `reply_text` válido: cai para
`allowHumanHandoff` (se ligado, marca para atendimento humano, mesmo texto de aviso
que as outras automações já usam) ou envia `noContentMessage` da fila. Em nenhum
cenário o cliente fica sem nenhuma resposta.

### Painel

Novo card de tipo em "Filas e automações", ao lado de Ofertas/Horários/Personalizada:
campos de URL, segredo (campo de senha, com botão "Gerar" sugerindo um valor aleatório
forte), timeout, e os campos comuns que as outras automações já usam. Mesmo padrão
visual dos cards existentes — sem inventar um componente novo do zero.

## Testes

- Unitário: `webhookAutomationConfigSchema` (URL inválida, segredo curto, timeout fora
  do intervalo).
- Unitário: assinatura HMAC do `queue-webhook-client.ts` — corpo determinado gera
  assinatura determinada; timeout dispara sem retry; resposta com `handoff: true` é
  interpretada corretamente; resposta malformada cai no fallback.
- Unitário: resolução da fila padrão (`default_queue_id` nulo preserva comportamento
  atual; configurado e válido é usado; configurado mas fila inativa/excluída não
  quebra, cai para `null` como hoje).
- Integração (`tests/integration/queue-automation-db.test.ts`, mesmo padrão dos testes
  existentes de offers/hours): fila tipo `webhook` publicada, mensagem simulada,
  webhook mockado responde e a mensagem certa é enviada; humano assume e a automação
  para de responder.

## Migração

Uma migration nova em `supabase/migrations/`, no padrão numerado já usado
(`202609010025_queue_webhook_automation.sql` ou próximo número livre): coluna
`organizations.default_queue_id` e o novo valor aceito na constraint/enum de
`queue_type` das tabelas envolvidas. Aditiva, não quebra nenhum tenant existente —
`default_queue_id` nasce `null` em todos, `webhook` é só mais um valor possível.
