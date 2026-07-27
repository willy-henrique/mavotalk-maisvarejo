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
npm test               → 99/99 aprovados
npm run test:e2e       → 8 testes corretamente ignorados sem credenciais QA
npm --prefix frontend run build → aprovado
npm run build           → aprovado (Next.js, 43 páginas/rotas geradas)
npm run render:validate → aprovado
```

## Limites conhecidos

- A suíte E2E não é considerada aprovada enquanto estiver ignorada; faltam password, origem de API e tenants QA controlados.
- A execução anônima contra o Render alcançou a tela de login e não expôs conteúdo administrativo nas quatro dimensões, mas foi reprovada pela observabilidade devido ao aviso de console CSP da versão atualmente publicada. A causa foi corrigida no repositório (diretiva `frame-ancestors` removida da meta tag); é necessário publicar e repetir a execução para obter a evidência pós-deploy.
- A validação de RLS foi estática/arquitetural nesta fase. O teste negativo integral A→B ainda requer dois tenants de QA controlados e credenciais locais para não tocar em dados de terceiros.
- Ainda faltam cenários E2E para Inbox, multi-tenancy A→B, WhatsApp, agentes, auditoria e administração. O plano permanece em `docs/e2e-test-plan.md`.
- A matriz granular preserva padrões de acesso seguros quando não há override, mas a prova dinâmica de que um override do tenant A jamais afeta o tenant B ainda exige os dois tenants QA controlados.
- A página de filas ainda não dispõe de modelo persistido para prioridade, horário, overflow, atendentes e reordenação drag-and-drop. Esses campos não foram simulados no frontend.
- Equipe agora registra e exibe o último login com escopo de tenant. Convites e filas associadas ainda exigem modelagem/endpoints antes de serem exibidos como informação real.
- O painel master passou a permitir seleção de organização somente sob sessão de plataforma. A existência da organização é confirmada antes de consultas, sincronização de filas e gravações de configuração; sessões operacionais permanecem vinculadas à organização do próprio cookie.
- O Inbox atualiza a URL com a conversa escolhida, restaura esse contexto após refresh/deep link e aceita Enter ou Espaço para abrir uma conversa pela lista.
- As telas de Equipe e Filas e automações deixam de falhar silenciosamente ao carregar: o erro é apresentado com `role=alert` e ação de tentativa novamente, separado dos erros de gravação do formulário.
- A revogação de agentes usa confirmação acessível em diálogo, em vez de confirmação nativa do navegador; a ação permanece bloqueada durante o envio e recebe estilo destrutivo consistente.
- O cabeçalho operacional passou a publicar breadcrumb e título de aba por rota pela mesma fonte de metadados, evitando cabeçalhos genéricos ou títulos do navegador desatualizados.
- Criação, edição e exclusão de respostas rápidas passaram a gerar auditoria por organização com nome/categoria ou campos alterados, sem persistir o conteúdo da mensagem na trilha.
- Ações reveladas em hover de filas também se revelam por foco de teclado, e a SPA respeita `prefers-reduced-motion` para reduzir animações não essenciais.
- O drawer de navegação em telas menores agora fecha com `Escape`, além do clique no overlay e da navegação por item.
- Foram criados `LoadingState`, `EmptyState` e `ErrorState` compartilhados e aplicados em Indicadores do negócio, Contatos, Agentes, Acessos gerenciais e Respostas rápidas; as falhas dessas áreas agora oferecem repetição explícita.
- A mesma camada de estados passou a atender Equipe, Filas e automações e Menu do painel, eliminando carregamentos e falhas com estilos próprios nessas configurações administrativas.
- O Inbox agora é uma rota carregada sob demanda: a tela de login não baixa sua lógica de Socket.IO e conversas antes de existir sessão autenticada.
- A build da SPA reduziu o chunk inicial de 348,5 kB / 108,3 kB gzip para 270,5 kB / 85,3 kB gzip. O código do Inbox passou ao seu próprio chunk de 76,0 kB / 22,6 kB gzip, carregado apenas pela rota autenticada.
- Mutações autenticadas por cookie sem cabeçalho `Origin` agora são recusadas no servidor; chamadas de webhooks e agentes, que não usam cookie de navegador, continuam explicitamente preservadas.
- A tela de Equipe filtra e pagina no servidor dentro do contexto RLS do tenant, mostra o intervalo exibido e retorna à primeira página ao alterar os critérios.
- Respostas rápidas agora permitem busca e paginação no servidor sob contexto RLS do tenant, com estado vazio específico para uma busca sem correspondência.
- O painel de Menu do painel agora separa visibilidade de navegação e permissões de backend. A matriz é resolvida por organização no servidor e passou a proteger Inbox, contatos, filas, respostas rápidas, WhatsApp, indicadores, auditoria, agentes, equipe e acessos gerenciais.
- Filas e automações agora inclui busca e filtro de status; até oito filas ficam em cards e volumes maiores passam a uma tabela operacional, sem ordenar mutando o estado local.
- Agentes e sincronização agora mostra uma ação recomendada derivada do estado real da instalação, sem expor endereço de rede.
- Filas podem ser excluídas somente quando não possuem conversas ou tickets vinculados; a API usa a permissão de exclusão, registra auditoria e retorna conflito explícito em vez de apagar histórico.
- Acessos gerenciais agora busca por nome/telefone e filtra função ou estado no servidor, sempre com `organization_id` no contexto estrito do tenant.
- A leitura de configuração da empresa no painel master agora recebe a requisição e valida a organização selecionada também no `GET`, não somente nas mutações.
- A sincronização do menu no painel master deixou de usar confirmação nativa; agora há diálogo semântico, foco inicial e fechamento por Escape.
- Agentes e sincronização passou a buscar por instalação e filtrar estados online, com atenção ou revogado no servidor, preservando o escopo da organização. O estado usa o último lote sincronizado, sem manter falhas antigas como alerta atual.
- A listagem e exportação da Auditoria gerencial agora passam o contexto do tenant na ordem correta para a consulta RLS; isso corrige uma falha de execução que o TypeScript não detectava por envolver parâmetros textuais.
