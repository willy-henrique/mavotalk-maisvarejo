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
- A sidebar apresenta uma única entrada “Agentes e sincronização”; `/admin/agentes` redireciona para `/business/sincronizacao` para preservar compatibilidade sem duplicar a experiência.
- A área unificada de agentes agora expõe logs recentes por instalação, sempre filtrados pela organização da sessão; IP de origem permanece mascarado/ausente da interface.
- As consultas de auditoria, agentes, configurações do bot/supermercado, visibilidade do menu, indicadores do negócio e acessos gerenciais passaram a executar no contexto RLS estrito da organização. O filtro explícito por `organization_id` permanece como defesa adicional.
- A auditoria gerencial ganhou filtros, paginação e ordenação server-side, detalhe em drawer, exportação CSV limitada a 10 mil registros filtrados e remoção do identificador técnico de tenant da tabela principal. Telefones sem nome associado são mascarados inclusive na exportação.
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
npm test               → 82/82 aprovados
npm run test:e2e       → 8 testes corretamente ignorados sem credenciais QA
npm --prefix frontend run build → aprovado
```

## Limites conhecidos

- A suíte E2E não é considerada aprovada enquanto estiver ignorada; faltam password, origem de API e tenants QA controlados.
- A execução anônima contra o Render alcançou a tela de login e não expôs conteúdo administrativo nas quatro dimensões, mas foi reprovada pela observabilidade devido ao aviso de console CSP da versão atualmente publicada. A causa foi corrigida no repositório (diretiva `frame-ancestors` removida da meta tag); é necessário publicar e repetir a execução para obter a evidência pós-deploy.
- A validação de RLS foi estática/arquitetural nesta fase. O teste negativo integral A→B ainda requer dois tenants de QA controlados e credenciais locais para não tocar em dados de terceiros.
- Ainda faltam cenários E2E para Inbox, multi-tenancy A→B, WhatsApp, agentes, auditoria e administração. O plano permanece em `docs/e2e-test-plan.md`.
- “Menu do painel” ainda controla apenas visibilidade porque a matriz granular de leitura/criação/edição/exclusão/administrativa exige uma evolução de RBAC no backend, não uma alteração cosmética de UI.
- A página de filas ainda não dispõe de modelo persistido para prioridade, horário, overflow, atendentes e reordenação drag-and-drop. Esses campos não foram simulados no frontend.
- Equipe agora registra e exibe o último login com escopo de tenant. Convites e filas associadas ainda exigem modelagem/endpoints antes de serem exibidos como informação real.
- O painel master passou a permitir seleção de organização somente sob sessão de plataforma. A existência da organização é confirmada antes de consultas, sincronização de filas e gravações de configuração; sessões operacionais permanecem vinculadas à organização do próprio cookie.
- O Inbox atualiza a URL com a conversa escolhida, restaura esse contexto após refresh/deep link e aceita Enter ou Espaço para abrir uma conversa pela lista.
- As telas de Equipe e Filas e automações deixam de falhar silenciosamente ao carregar: o erro é apresentado com `role=alert` e ação de tentativa novamente, separado dos erros de gravação do formulário.
- A revogação de agentes usa confirmação acessível em diálogo, em vez de confirmação nativa do navegador; a ação permanece bloqueada durante o envio e recebe estilo destrutivo consistente.
- O cabeçalho operacional passou a publicar breadcrumb e título de aba por rota pela mesma fonte de metadados, evitando cabeçalhos genéricos ou títulos do navegador desatualizados.
