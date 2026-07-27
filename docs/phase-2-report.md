# Fase 2 — automação E2E e fundação de Design System

Data: 2026-07-27.

## Entregas

- Adicionado Playwright com quatro projetos: desktop 1366×768, desktop 1920×1080, tablet e mobile 390×844.
- Criada observabilidade de browser: erros de console/JavaScript, respostas HTTP de interesse, falhas e requisições pendentes são anexados ao resultado do teste.
- Criada a primeira suíte autenticada: login, prevenção visual de reenvio, refresh, deep link, logout e rota protegida. Ela executa somente quando `QA_BASE_URL`, `QA_EMAIL` e `QA_PASSWORD` existem no ambiente.
- Adicionado cenário anônimo de rota administrativa direta, executável somente com `QA_BASE_URL`; ele não cria nem altera dados de QA.
- Artefatos de teste (`playwright-report`, `test-results`, `blob-report`) foram excluídos do versionamento. Screenshots/trace são preservados somente em falha; vídeo fica desligado.
- Adicionados tokens semânticos de cor, superfície, tipografia operacional, foco, espaçamento, sombra, raio, z-index e transição. O ambiente operacional inicia em tema escuro sem flash branco.
- Criado `Dialog` acessível reutilizável com foco inicial, focus trap, Escape, clique externo e restauração de foco; o editor de respostas rápidas foi migrado.
- `Menu do painel` passou a usar switches acessíveis, mostra alterações não salvas, confirma salvamento e mantém explícita a diferença entre visibilidade e RBAC.
- A sidebar apresenta uma única entrada “Agentes e sincronização”; a rota legada de agentes continua disponível para compatibilidade.
- A área unificada de agentes agora expõe logs recentes por instalação, sempre filtrados pela organização da sessão; IP de origem permanece mascarado/ausente da interface.
- A auditoria gerencial ganhou filtros server-side, paginação, detalhe em drawer e remoção do identificador técnico de tenant da tabela principal.
- O dashboard operacional passou a calcular SLA próximo/vencido, resolução média, agentes online e frescor da última sincronização diretamente dos dados persistidos.
- O menu de usuário no topo passou a funcionar por clique, com `aria-expanded`, fechamento por Escape e clique externo.
- Contatos, equipe, respostas rápidas, filas/automações, acessos gerenciais e central de conexão foram migrados gradualmente para os mesmos tokens de página, cards, botões e campos; o tema escuro deixa de depender de estilos específicos de cada tela.
- Filas/automações agora usam terminologia operacional, diálogo acessível para edição e switch semântico para a opção do menu do bot.
- Acessos gerenciais deixaram de usar `window.prompt` para PIN: criação, redefinição de PIN e permissões ocorrem em diálogos acessíveis, com prevenção de duplo envio, mensagens de êxito/erro e sem expor o PIN após o envio.
- A central de conexão do WhatsApp passou a apresentar estados técnicos em linguagem de operação e preserva os controles Baileys/Twilio existentes.
- O foco inicial de diálogos pode apontar para o campo de trabalho do formulário, sem perder o focus trap, Escape e restauração de foco.

## Testes

```text
npm run typecheck:all  → aprovado
npm test               → 76/76 aprovados
npm run test:e2e       → 8 testes corretamente ignorados sem credenciais QA
npm --prefix frontend run build → aprovado
```

## Limites conhecidos

- A suíte E2E não é considerada aprovada enquanto estiver ignorada; faltam password, origem de API e tenants QA controlados.
- A execução anônima contra o Render encontrou o aviso de console CSP da versão atualmente publicada. A causa foi corrigida no repositório (diretiva `frame-ancestors` removida da meta tag); é necessário publicar e repetir a execução para obter a evidência pós-deploy.
- Ainda faltam cenários E2E para Inbox, multi-tenancy A→B, WhatsApp, agentes, auditoria e administração. O plano permanece em `docs/e2e-test-plan.md`.
- “Menu do painel” ainda controla apenas visibilidade porque a matriz granular de leitura/criação/edição/exclusão/administrativa exige uma evolução de RBAC no backend, não uma alteração cosmética de UI.
- A página de filas ainda não dispõe de modelo persistido para prioridade, horário, overflow, atendentes e reordenação drag-and-drop. Esses campos não foram simulados no frontend.
- Equipe ainda depende do modelo atual para convites, último login e filas associadas; esses dados exigem endpoints/modelagem antes de serem exibidos como informação real.
