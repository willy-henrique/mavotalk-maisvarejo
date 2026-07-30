# Operação comercial — ofertas, entrega e pedidos

## O que foi adicionado

- Promoções multiempresa com validade, status, mídia e auditoria.
- Estrutura de endereço, horários especiais, intervalo e fuso por empresa.
- Configuração de entrega, previsão persistida no pedido e fluxo de status.
- Histórico de pedido e outbox idempotente para a notificação de despacho.

## Migrations

Execute `npm run db:migrate`. A migration `202607290011_commerce_operations.sql` é aditiva: não remove dados nem arquivos. Ela cria `promotions`, `promotion_media`, `business_locations`, `business_special_hours`, `delivery_settings`, `delivery_schedule`, `orders`, `order_status_history` e `notification_outbox`, com RLS por `organization_id`.

Depois, execute `npm run db:verify` no ambiente alvo.

## Ofertas

Use `POST /api/promotions` autenticado para criar uma promoção. A validade padrão do painel/cliente deve ser de 24 horas; o servidor aceita qualquer intervalo UTC válido. O bot consulta somente registros com:

```text
organization_id atual + status active + starts_at <= agora + expires_at > agora
```

Logo, uma expiração não depende do worker. O status visual pode ser atualizado por rotina futura sem alterar a regra de segurança.

## Entregas e pedidos

`PATCH /api/admin/delivery-settings` registra tempos e dias de entrega por empresa. Ao criar um pedido em `POST /api/orders`, a faixa calculada é persistida nos campos `estimated_*`; alterar a configuração depois não muda pedidos já registrados.

Transições permitidas: `received → confirmed → preparing → ready → dispatched → delivered`; qualquer estado em aberto pode ser cancelado. O despacho cria histórico e um evento único de outbox (`order-dispatched:<orderId>`).

O worker BullMQ processa `order-notifications`. Com `WILLTALK_DRY_RUN_WHATSAPP=true`, a entrega é simulada. Em produção, o worker exige o canal Twilio configurado; falhas ficam registradas e respeitam o limite de tentativas.

## Segurança e permissões

O tenant vem exclusivamente da sessão ou da integração autenticada. Endpoints administrativos usam sessão + política de menu; todas as consultas novas usam `queryTenantDatabase` ou `withTenantTransaction`, e o banco aplica RLS como segunda barreira. Nunca envie `organization_id` no corpo da API administrativa.

## Homologação manual

1. Aplicar migration e entrar com uma conta admin/gestor de uma empresa de teste.
2. Criar promoção ativa para as próximas 24 horas e confirmar que a consulta “ofertas” a retorna.
3. Alterar a expiração para o passado e confirmar que o bot retorna “não há promoções ativas”.
4. Configurar entrega, criar pedido e confirmar que `estimated_start_at`/`estimated_end_at` foram persistidos.
5. Avançar o pedido até `dispatched`; confirmar uma linha no histórico e uma única entrada de outbox.
6. Repetir a chamada de despacho e confirmar que nenhuma nova notificação é criada.
7. Tentar acessar os mesmos IDs com usuário de outra empresa: a resposta deve ser 404/sem dados.

## Deploy e rollback

1. Executar `npm run typecheck:all`, `npm run lint`, `npm test`, `npm run build` e `npm run db:migrate`.
2. Configurar Redis e o worker; validar `GET /api/readiness`.
3. Fazer smoke test com `WILLTALK_DRY_RUN_WHATSAPP=true` antes do envio real.
4. Rollback da aplicação: publicar a versão anterior é seguro porque a migration é aditiva. Não remova as tabelas em produção; desative o recurso/rotas se for necessário interromper a operação.

## Limitações intencionais

Não há estoque em tempo real, GPS, confirmação automática de entrega ou sincronização de ERP. O bot deve encaminhar consultas de disponibilidade a um atendente, sem confirmar estoque.
