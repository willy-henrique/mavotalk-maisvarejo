# Mavo Talk — Estágio Atual do Projeto

**Responsável:** Will · **Frente:** Mavo Talk & Consumo (Mensageria / WhatsApp)
**Data do relatório:** 31/07/2026
**Repositório:** https://github.com/willy-henrique/willtalk (privado)
**Conta GitHub:** `willy-henrique` — https://github.com/willy-henrique

---

## 1. Resumo executivo

O Mavo Talk é a **central de conversas de WhatsApp** da Mavo: recebe a mensagem do cliente, faz a triagem pelo bot **Mavo**, distribui em filas por demanda e entrega a conversa ao atendente humano em tempo real.

**Status: em produção**, publicado no Render com Supabase como banco oficial, rodando multiempresa com isolamento por tenant (RLS). A última entrega funcional foi em **29/07** (operação comercial: promoções, entrega e pedidos).

| Indicador | Situação |
|---|---|
| Ambiente | Produção (Render + Supabase) |
| Commits no repositório | 140 |
| Rotas de API implementadas | 62 |
| Migrations versionadas | 15 (todas aditivas) |
| Arquivos de teste | 57 unitários/integração + 3 E2E (Playwright) |
| Última entrega | 29/07/2026 |

---

## 2. Stack

- **Next.js 16 + TypeScript** (API e servidor customizado `server.cjs`)
- **React 19 + Vite** — SPA operacional em `frontend/`
- **Supabase PostgreSQL** — banco oficial, com RLS por `organization_id`
- **WhatsApp** com provider configurável:
  - `unofficial` via **Baileys** (QR Code, auth state cifrado e persistido no Supabase)
  - `twilio` via webhook
- **Socket.IO** — tempo real no inbox
- **BullMQ + Redis** — jobs assíncronos (notificações de pedido, mídia, SLA)
- **Cloudinary** — mídias (imagem/documento)
- **Render** — deploy via Blueprint (`render.yaml`), health check em `/api/health`

---

## 3. O que já está entregue

### 3.1 Canal WhatsApp
- Conexão por QR Code (Baileys) e por Twilio, alternável por variável de ambiente.
- Sessão do WhatsApp **cifrada e persistida no Supabase** — não depende do filesystem efêmero do Render.
- Diagnóstico e status do canal expostos em `/api/whatsapp/status`, `connect` e `disconnect`.
- Modo `WILLTALK_DRY_RUN_WHATSAPP=true` para homologar fluxo completo sem enviar mensagem real.

### 3.2 Bot Mavo (supermercado)
Seis jornadas fechadas, com menu numérico **e** linguagem natural:
1. Ofertas e promoções · 2. Horários e localização · 3. Produtos e disponibilidade
4. Açougue, padaria e hortifruti · 5. Trocas, devoluções e pagamentos · 6. Falar com atendente

Regras de operação já aplicadas:
- **Nunca confirma preço ou estoque sem fonte confiável** — encaminha para a equipe.
- Nunca pede senha, cartão ou dado bancário.
- Após transferência, o bot silencia para o atendente assumir.
- `0` reabre o menu a qualquer momento; fora do expediente há aviso claro e registro.
- Filas 1–6 sincronizadas de forma **idempotente** (filas fora do modelo são pausadas, nunca apagadas).

### 3.3 Central de atendimento
- Inbox em tempo real, fila `Aguardando`, cards por demanda e cor por fila.
- Atribuição, encerramento, indicador de digitação e upload de mídia.
- Respostas rápidas com **preview de variáveis**.
- Contatos com paginação, SLA por fila e trilha de auditoria.

### 3.4 Operação comercial (entrega de 29/07)
- **Promoções** multiempresa com validade, status, mídia e auditoria — o bot só lê o que está ativo e dentro da janela.
- **Entrega**: configuração por empresa, previsão calculada e **persistida no pedido** (mudar a config depois não altera pedidos já feitos).
- **Pedidos** com máquina de estados `received → confirmed → preparing → ready → dispatched → delivered`, histórico e **outbox idempotente** na notificação de despacho.

### 3.5 Painel master `/mavo`
Login isolado, saúde do Supabase, integrações, indicadores, filas, usuários, horários, configuração do Mavo e auditoria — visão multiempresa.

### 3.6 Segurança e multiempresa
- Tenant vem **exclusivamente da sessão** ou da integração autenticada — nunca do corpo da requisição.
- Toda consulta nova usa `queryTenantDatabase` / `withTenantTransaction`, com **RLS no banco como segunda barreira**.
- Acesso de negócio com PIN, bloqueio, revogação de sessão e proteção do último admin.

### 3.7 Integrações prontas (ponto de conexão com o time)
| Direção | Rota / recurso |
|---|---|
| Mavo Talk → n8n / Cérebro | `WILLTALK_WEBHOOK_URL` (eventos de ticket e mensagem) |
| Cérebro → Mavo Talk | `POST /api/webhooks/cerebro/reply` |
| Entrada bot-first | `POST /api/webhooks/n8n/ticket-upsert` |
| Twilio | `POST /api/webhooks/twilio` |
| **Agent Cloud API** | `/api/agent/v1/config`, `heartbeat`, `sync/inventory-entries`, `sync/product-sales`, `sync/sales-daily` |
| MCP | servidor de ferramentas de negócio (`npm run mcp:business`) |

> As rotas de `sync/*` já existem e são a **porta de entrada natural para os dados do Heitor** (Produtos, Preços e Promoções vindos do Firebird pelo MAVO Edge Sync).

---

## 4. Obstáculos

### 4.1 Infraestrutura em plano gratuito (principal limitador)
O Blueprint roda **100% em instâncias free**, e isso impõe limites reais e documentados:
- O serviço web **hiberna após 15 min sem tráfego** e leva ~1 min para acordar — primeira mensagem do dia pode atrasar.
- **Background Worker não tem plano gratuito** → as filas rodam dentro do processo web (`MAVO_INLINE_WORKER=true`).
- O **Key Value gratuito não tem persistência** → a fila é best-effort.
- `preDeployCommand` exige plano pago → as **migrations rodam no build**, o que torna o build mais frágil.

**Impacto:** estabilidade de produção está limitada pela infraestrutura, não pelo código. É a decisão de orçamento com maior efeito no SLA percebido.

### 4.2 Deploy travado no Render — resolvido em 27/07
O deploy ficou ~2h em "Building" sem log de erro: uma etapa de banco pendurava em advisory lock sem teto de tempo. Corrigido com **fail-fast e teto por etapa** (`runDeployStep`) e enxugamento do `buildCommand`. Regra operacional adotada: **cancelar qualquer deploy que passe de 20 min**.

### 4.3 Ausência de fonte de dados de produto
Hoje o bot **não tem estoque, preço ou encarte reais**. Promoções são cadastradas manualmente no painel. Por decisão de projeto, disponibilidade é sempre encaminhada a um atendente — o bot não inventa. É exatamente o gargalo que a entrega do Heitor destrava.

### 4.4 Canal não oficial (Baileys)
O provider `unofficial` depende de sessão de WhatsApp Web: sujeito a reconexão e a risco de bloqueio do número. A sessão cifrada no Supabase mitiga a perda por reinício, mas não elimina o risco do canal. O provider Twilio já está implementado como caminho oficial quando houver orçamento.

---

## 5. Oportunidades / próximos passos

Alinhado ao compromisso da sprint:

1. **Contratos de consumo de APIs externas no bot** — deixar a "casa pronta" para consumir Produtos, Preços e Promoções do Heitor (MAVO Edge Sync / FastAPI / Supabase) na sprint do **Flyers v1**. As rotas `agent/v1/sync/*` e a camada `lib/agent-cloud` já são a base; falta o contrato de leitura de catálogo.
2. **Substituir promoções manuais por dados reais** — quando o contrato de promoções do Heitor estiver exposto, a jornada "Ofertas" passa de cadastro manual para encarte automático.
3. **Validação de UX do bot** — varredura das seis jornadas com telefone de teste em `DRY_RUN`, meta de **zero erro de interface**.
4. **Suporte ao go-live do Mavo.Ai (01/08)** — Mavo Talk como canal de entrada e de resposta.
5. **Evolução de infraestrutura** (depende de orçamento): worker dedicado + Redis persistente + instância que não hiberna resolvem, de uma vez, os itens 4.1 e boa parte da percepção de instabilidade.

---

## 6. Como rodar localmente

```bash
npm ci
npm --prefix frontend ci
npm run db:migrate:status && npm run db:migrate && npm run db:verify
npm run dev                 # API em http://localhost:4002
cd frontend && npm run dev  # SPA
```

Verificação antes de subir:

```bash
npm run typecheck:all && npm run lint && npm test && npm run build
```

Documentação de referência no repositório: `docs/BOT-SUPERMERCADO.md`, `docs/DEPLOY-SUPABASE-RENDER.md`, `docs/OPERACAO-COMERCIAL-2026-07-29.md`, `docs/integracao-mavo-cerebro-operacional.md`.

---

## 7. Acesso

Para liberação de permissão no repositório privado:

- **GitHub:** `willy-henrique` — https://github.com/willy-henrique
