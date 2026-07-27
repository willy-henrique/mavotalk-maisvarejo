# Fase 2 — automação E2E e fundação de Design System

Data: 2026-07-27.

## Entregas

- Adicionado Playwright com quatro projetos: desktop 1366×768, desktop 1920×1080, tablet e mobile 390×844.
- Criada observabilidade de browser: erros de console/JavaScript, respostas HTTP de interesse, falhas e requisições pendentes são anexados ao resultado do teste.
- Criada a primeira suíte autenticada: login, prevenção visual de reenvio, refresh, deep link, logout e rota protegida. Ela executa somente quando `QA_BASE_URL`, `QA_EMAIL` e `QA_PASSWORD` existem no ambiente.
- Artefatos de teste (`playwright-report`, `test-results`, `blob-report`) foram excluídos do versionamento. Screenshots/trace são preservados somente em falha; vídeo fica desligado.
- Adicionados tokens semânticos de cor, superfície, tipografia operacional, foco, espaçamento, sombra, raio, z-index e transição. O ambiente operacional inicia em tema escuro sem flash branco.
- Criado `Dialog` acessível reutilizável com foco inicial, focus trap, Escape, clique externo e restauração de foco; o editor de respostas rápidas foi migrado.
- `Menu do painel` passou a usar switches acessíveis, mostra alterações não salvas, confirma salvamento e mantém explícita a diferença entre visibilidade e RBAC.
- A sidebar apresenta uma única entrada “Agentes e sincronização”; a rota legada de agentes continua disponível para compatibilidade.
- A área unificada de agentes agora expõe logs recentes por instalação, sempre filtrados pela organização da sessão; IP de origem permanece mascarado/ausente da interface.
- A auditoria gerencial ganhou filtros server-side, paginação, detalhe em drawer e remoção do identificador técnico de tenant da tabela principal.
- O dashboard operacional passou a calcular SLA próximo/vencido, resolução média, agentes online e frescor da última sincronização diretamente dos dados persistidos.
- O menu de usuário no topo passou a funcionar por clique, com `aria-expanded`, fechamento por Escape e clique externo.

## Testes

```text
npm run typecheck:all  → aprovado
npm test               → 73/73 aprovados
npm run test:e2e       → 8 testes corretamente ignorados sem credenciais QA
npm --prefix frontend run build → aprovado
```

## Limites conhecidos

- A suíte E2E não é considerada aprovada enquanto estiver ignorada; faltam password, origem de API e tenants QA controlados.
- Ainda faltam cenários E2E para Inbox, multi-tenancy A→B, WhatsApp, agentes, auditoria e administração. O plano permanece em `docs/e2e-test-plan.md`.
- “Menu do painel” ainda controla apenas visibilidade porque a matriz granular de leitura/criação/edição/exclusão/administrativa exige uma evolução de RBAC no backend, não uma alteração cosmética de UI.
