# Integracao Cérebro -> WillTalk (Auto Reply)

## Rota

- `POST /api/webhooks/cerebro/reply`

Observacao:

- A rota efetiva e validada pelo app usa `WILLTALK_AUTO_REPLY_ROUTE`.
- Valor padrao recomendado: `/webhooks/cerebro/reply`.

## Auth

- Header obrigatorio: `Authorization: Bearer <WILLTALK_WEBHOOK_TOKEN>`

## Payload esperado

```json
{
  "ticket_id": "WT-12345",
  "cliente": "Loja XPTO",
  "canal": "whatsapp",
  "resposta_sugerida": "Passos recomendados...",
  "origem": "cerebro-operacional",
  "data_evento": "2026-03-26T18:30:00Z"
}
```

Campos obrigatorios:

- `ticket_id`
- `canal`
- `resposta_sugerida`

## Exemplo curl

```bash
curl -i -X POST "http://localhost:4002/api/webhooks/cerebro/reply" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer trocar_token_forte" \
  -d '{
    "ticket_id": "WT-12345",
    "cliente": "Loja XPTO",
    "canal": "whatsapp",
    "resposta_sugerida": "Passos recomendados...",
    "origem": "cerebro-operacional",
    "data_evento": "2026-03-26T18:30:00Z"
  }'
```

## Troubleshooting rapido

- `401 unauthorized`: token bearer ausente/invalido.
- `400 payload_invalido`: faltando `ticket_id`, `canal` ou `resposta_sugerida`.
- `404 ticket_nao_encontrado`: ticket/conversa nao localizado no WillTalk.
- `502 whatsapp_send_failed`: falha ao enviar no provider WhatsApp (Twilio/unofficial).
- `200 duplicate_ignored`: mesma resposta ja enviada para o mesmo ticket nos ultimos 5 minutos.
