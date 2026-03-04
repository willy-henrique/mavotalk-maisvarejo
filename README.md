# WillTalk - Plataforma de Suporte WhatsApp

Sistema profissional de atendimento com triagem numerica, fila `Aguardando`, cards por demanda e chat em tempo real.

## Stack atual

- Next.js 16 + TypeScript
- Firebase Admin + Firestore
- WhatsApp por provider configuravel:
  - `unofficial` via `whatsapp-web.js` (QR Code)
  - `twilio` via webhook
- Cloudinary (midias imagem/documento)
- Socket.IO (tempo real)
- BullMQ + Redis (jobs assincronos)

## Configuracao

1. Copie `.env.example` para `.env` e ajuste variaveis.
2. Instale dependencias:

```bash
npm install
```

3. Rode seed inicial no Firebase (admin + demandas + horario):

```bash
npm run seed
```

4. Rode o app:

```bash
npm run dev
```

Aplicacao: `http://localhost:3000`

Login inicial:

- E-mail: `admin@willtalk.local`
- Senha: `admin123`

## Endpoints principais

- `POST /api/webhooks/twilio`
- `GET /api/whatsapp/status`
- `POST /api/whatsapp/connect`
- `POST /api/whatsapp/disconnect`
- `POST /api/conversations/:id/assign`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/close`
- `GET /api/queues`
- `POST /api/queues`
- `PATCH /api/queues/:id`
- `GET /api/dashboard/metrics`
- `GET /api/conversations?status=aguardando`

## Fluxo de triagem

1. Mensagem inbound cria/atualiza conversa em `Aguardando`.
2. Bot envia menu numerico com demandas ativas.
3. Opcao valida classifica fila e cor do card.
4. Opcao invalida repete menu; apos 3 tentativas envia para humano.

## Cloudinary

Quando chega midia (Twilio ou WhatsApp QR), o sistema tenta fazer upload no Cloudinary e salva `secure_url`.
Se o upload falhar, segue com fallback.

## Modo QR Code (nao oficial)

1. Em `.env`, defina `WHATSAPP_PROVIDER=\"unofficial\"`.
2. Acesse o dashboard e use o bloco `WhatsApp QR`.
3. Clique em `Gerar QR` e escaneie no WhatsApp do celular.
4. Com status `ready`, mensagens entram na fila automaticamente.

## Worker

Para processar filas assicronas:

```bash
npm run worker
```
