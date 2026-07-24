# SPA do Mavo Talk

Interface principal React/Vite do produto.

## Desenvolvimento

Pré-requisito: Node.js 22.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

A API local usa `http://localhost:4002`. As únicas variáveis públicas são
`VITE_API_BASE_URL` e `VITE_SOCKET_URL`. Chaves de IA, JWT, Supabase service
role, Cloudinary e Mavo AI pertencem exclusivamente ao backend.

## Validação

```bash
npm run typecheck
npm run build
```

No Render, publique `dist` como Static Site e configure o rewrite
`/* -> /index.html`.
