# Auditoria UX/UI — baseline de auditoria

Data da inspeção: 2026-07-27. Avaliação estática baseada na SPA principal e em seus estados implementados. Não foram capturados screenshots autenticados porque a credencial QA não foi disponibilizada localmente.

## Diagnóstico

O produto possui direção visual azul/verde, modo escuro padrão e uma fundação de design system com tokens, `Dialog` acessível e primitives de página, card, botão e campo. A migração ainda é incremental: tabelas, filtros, badges e alguns estados continuam sendo definidos por tela, causando inconsistências residuais na administração.

## Achados priorizados

| Severidade | Achado | Evidência / impacto |
| --- | --- | --- |
| Resolvido | SLA não era acionado nem processado | O agendamento por ticket, worker transacional, idempotência e auditoria foram implementados; a confirmação de execução contínua ainda depende de observabilidade no Render. |
| Resolvido | Duplicidade entre sincronização e agentes | `/admin/agentes` redireciona para a rota canônica `/business/sincronizacao`; a sidebar expõe uma única seção. |
| Resolvido | Cabeçalho incorreto em Menu do painel | Metadado específico foi incluído no `AppHeader`; não há fallback de “Caixa de entrada”. |
| Resolvido | Auditoria pouco utilizável | Filtros, paginação e ordenação server-side, detalhe acessível, contraste no tema escuro, mascaramento de telefone e exportação CSV limitada ao tenant. |
| Resolvido | Contatos transferia o tenant inteiro para filtrar no navegador e a tabela era pouco adaptável | Busca, filtro de bloqueio e paginação agora são server-side, com consulta RLS estrita e somente a última interação da página exibida; em mobile a tabela vira cartões operacionais sem rolagem horizontal. |
| P2 | Primitives compartilhadas incompletas | Tokens, `Dialog`, paginação, páginas, cards, botões, campos e estados de loading/vazio/erro foram centralizados; tabelas, filtros e badges ainda variam entre Equipe, Filas, Acessos, Agentes e Respostas rápidas. |
| P2 | Fluxos administrativos têm feedback desigual | Dashboard, Equipe e Filas expõem loading e falhas de carregamento com tentativa novamente; outras ações ainda não oferecem confirmação, prevenção uniforme de duplo envio, confirmação destrutiva ou aviso de alterações não salvas. |
| Resolvido | Dashboard não cobria a operação declarada | Calcula SLA próximo/vencido, resolução média, agentes online e frescor da última sincronização a partir de dados persistidos; não apresenta indicadores simulados como reais. |
| Resolvido | Acessibilidade de modais incompleta | Os diálogos administrativos usam `Dialog` com foco inicial, focus trap, Escape e restauração do foco. |
| Resolvido parcialmente | Contraste e escala no painel claro master | A área master possuía textos entre 6 e 9 px e superfícies com separação muito sutil. A escala de dados operacionais foi elevada para 10–13 px e cartões/bordas ganharam contraste explícito; a SPA operacional mantém tema escuro como padrão. |
| Resolvido | Agentes exigia rolagem horizontal em mobile | A tabela operacional é preservada no desktop; telas menores recebem cartões com saúde, sincronização, registros, recomendação e ações. |
| Resolvido | Tabelas administrativas não priorizavam informação em mobile | Equipe, Respostas rápidas, Acessos gerenciais e Auditoria preservam tabelas densas em desktop e passam a cartões com dados e ações equivalentes em telas menores. |
| Resolvido | Listas extensas de filas quebravam a densidade mobile | Quando há mais de oito filas, a tabela continua no desktop; no mobile ela passa a cartões com menu, SLA, estado e ações. |
| P3 | Estados vazios e largura | Há empty states altos em dashboards e tabelas; em monitores grandes a informação não usa largura/densidade operacional de forma consistente. |
| P3 | Terminologia e capitalização | A navegação e os atalhos usam “Respostas rápidas” e “Agentes e sincronização”; ainda é necessário revisar referências históricas fora da SPA. |

## Acessibilidade

Pontos já presentes: foco visível global, labels em boa parte dos formulários, `role=alert` em alguns erros, navegação mobile e `aria-label` em alguns ícones.

Lacunas: alguns menus acionados por hover/focus ainda não usam um dropdown compartilhado, ícones em botões ainda precisam de varredura por rota e a matriz multidimensional de permissões preserva rolagem horizontal por necessidade de comparação. As tabs de Menu do painel agora expõem relação tab/painel e teclado por setas, Home e End.

## Direção de implementação

1. Criar tokens CSS semânticos e primitives acessíveis (Button, Input, Select, Dialog, Table, StatusBadge, PageHeader, Empty/Loading/ErrorState).
2. Construir `AppShell` e uma única fonte de navegação/metadata de rotas; incluir breadcrumb e título da aba.
3. Consolidar Agentes e Sincronização em uma seção: Provisionamento, Monitoramento e Logs.
4. Migrar a administração por página, preservando chamadas de API e permissões; não reescrever Inbox em bloco.
5. Tratar loading, sucesso, falha, conflito e alterações não salvas em toda gravação.

## Capturas antes/depois

Pendente de execução autenticada com `QA_BASE_URL` e `QA_PASSWORD` configurados no ambiente local. As capturas devem usar dados de QA, mascarar telefone/e-mail quando necessário e ocorrer somente em falhas ou comparativos explícitos de regressão visual.
