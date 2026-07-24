# API cloud do agente

## Escopo

A API recebe somente agregados das views contratadas. Ela não expõe Firebird,
não aceita SQL, não confia em `organization_id` do corpo e não usa um token
global. Cada instalação pertence a um único tenant e recebe um segredo
individual exibido apenas no provisionamento ou rotação.

Base: `/api/agent/v1`.

| Método | Rota | Finalidade |
|---|---|---|
| `GET` | `/config` | contrato e intervalos atuais |
| `POST` | `/heartbeat` | estado/versão da instalação |
| `POST` | `/sync/sales-daily` | vendas diárias |
| `POST` | `/sync/product-sales` | vendas por produto |
| `POST` | `/sync/inventory-entries` | entradas de estoque |

Administração por cookie JWT e papel `admin`:

- `GET /api/admin/agents?page=1&pageSize=25`;
- `POST /api/admin/agents/provision`;
- `POST /api/admin/agents/:id/revoke`;
- `POST /api/admin/agents/:id/rotate-credential`.

## Provisionamento

```http
POST /api/admin/agents/provision
Content-Type: application/json

{"name":"Matriz — servidor ERP"}
```

A resposta contém `agentId`, `secret` e `keyVersion`. O `secret` deve ser
guardado no secret store do agente e não pode ser recuperado novamente. No
banco, ele fica cifrado por AES-256-GCM com
`MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY`; logs guardam no máximo uma impressão
digital curta.

Rotação revoga a credencial anterior na mesma transação. Revogação desativa
instalação e todas as credenciais ativas.

## Autenticação de requisição

Headers obrigatórios:

```text
X-Mavo-Agent-Id: agt_...
X-Mavo-Timestamp: 1784818800
X-Mavo-Nonce: valor-aleatorio-com-16-ou-mais-caracteres
X-Mavo-Signature: hmac-sha256-em-hex
Idempotency-Key: UUID-do-batch
Content-Type: application/json
```

`Idempotency-Key` é obrigatório nos três endpoints de sync e deve ser igual a
`batchId`.

String canônica:

```text
METHOD
/caminho/sem/query
timestamp-unix
nonce
sha256-do-corpo-exato
```

Assinatura:

```text
hex(HMAC-SHA256(secret_individual, string_canonica))
```

O timestamp aceita a tolerância configurada em
`MAVO_AGENT_CLOCK_TOLERANCE_SECONDS`. O nonce é reservado com `SET NX` no Redis;
se o Redis falhar, a tabela `agent_nonces` mantém a proteção. O mesmo nonce
retorna `409 REPLAY_DETECTED`.

O limite de bytes é aplicado durante a leitura do stream, inclusive para
transferência sem `Content-Length`.

## Envelope

```json
{
  "schemaVersion": "1.0",
  "batchId": "079d449d-6a99-4af7-bac8-e1e9f075fbea",
  "agentVersion": "0.1.0",
  "generatedAt": "2026-07-23T08:30:00-03:00",
  "sourceTimezone": "America/Sao_Paulo",
  "range": {
    "from": "2026-07-01",
    "to": "2026-07-23"
  },
  "records": [],
  "checksum": "sha256-hex-de-json-canonico-dos-records"
}
```

O JSON canônico ordena as chaves de objetos recursivamente e preserva a ordem
dos registros. O limite atual é 5.000 registros por lote e 1 MiB por payload,
configurável até o teto do serviço.

Resposta:

```json
{
  "accepted": true,
  "batchId": "079d449d-6a99-4af7-bac8-e1e9f075fbea",
  "duplicate": false,
  "receivedRecords": 23,
  "processedRecords": 23,
  "rejectedRecords": 0,
  "serverTime": "2026-07-23T12:00:00.000Z",
  "nextSyncAfterSeconds": 300
}
```

Reenviar o mesmo lote, com novo nonce e mesma assinatura correspondente,
retorna `duplicate: true` sem duplicar agregados. Reutilizar `batchId` com
checksum ou tipo diferente retorna `409 BATCH_CONFLICT`.

## Erros

| HTTP | Código típico | Ação |
|---|---|---|
| 400 | `INVALID_JSON`, `MISSING_IDEMPOTENCY_KEY` | corrigir requisição |
| 401 | `INVALID_AGENT`, `INVALID_SIGNATURE`, `EXPIRED_TIMESTAMP` | sincronizar relógio/credencial |
| 409 | `REPLAY_DETECTED`, `BATCH_CONFLICT` | gerar nonce ou novo batch |
| 413 | `PAYLOAD_TOO_LARGE` | dividir lote |
| 415 | `UNSUPPORTED_CONTENT_TYPE` | enviar JSON |
| 422 | `INVALID_PAYLOAD`, `CHECKSUM_MISMATCH` | corrigir contrato |
| 429 | `RATE_LIMITED` | respeitar `Retry-After` |
| 503 | `RATE_LIMIT_UNAVAILABLE` | retry com backoff |

Respostas não incluem stack, SQL, assinatura ou segredo.

## Simulador

```bash
MAVO_SIM_API_BASE_URL=http://localhost:4002 \
MAVO_SIM_AGENT_ID=agt_xxx \
MAVO_SIM_AGENT_SECRET=mavo_xxx \
npm run simulate:agent
```

O script envia heartbeat e dados fictícios, repete o lote, testa assinatura
incorreta, timestamp expirado, credencial revogada/desconhecida e versão
incompatível. Dados fictícios existem apenas no processo do simulador.
