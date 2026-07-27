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
| P2 | Primitives compartilhadas incompletas | Tokens, `Dialog`, páginas, cards, botões, campos e estados de loading/vazio/erro foram centralizados; tabelas, filtros e badges ainda variam entre Equipe, Filas, Acessos, Agentes e Respostas rápidas. |
| P2 | Fluxos administrativos têm feedback desigual | Algumas ações têm loading/erro; outras não oferecem confirmação, prevenção uniforme de duplo envio, confirmação destrutiva ou aviso de alterações não salvas. Equipe e Filas agora expõem falhas de carregamento com tentativa novamente. |
| Resolvido | Dashboard não cobria a operação declarada | Calcula SLA próximo/vencido, resolução média, agentes online e frescor da última sincronização a partir de dados persistidos; não apresenta indicadores simulados como reais. |
| Resolvido | Acessibilidade de modais incompleta | Os diálogos administrativos usam `Dialog` com foco inicial, focus trap, Escape e restauração do foco. |
| P3 | Mistura de tema e contraste | O tema escuro é default no provider, mas a base do `body` é clara e páginas têm superfícies/classes próprias. A percepção muda entre telas. |
| P3 | Estados vazios e largura | Há empty states altos em dashboards e tabelas; em monitores grandes a informação não usa largura/densidade operacional de forma consistente. |
| P3 | Terminologia e capitalização | “Tipos de Chamado”, “Respostas Rápidas”, “Agentes cloud” e “Sincronização” não seguem mesma nomenclatura. |

## Acessibilidade

Pontos já presentes: foco visível global, labels em boa parte dos formulários, `role=alert` em alguns erros, navegação mobile e `aria-label` em alguns ícones.

Lacunas: alguns menus acionados por hover/focus ainda não usam um dropdown compartilhado, ícones em botões ainda precisam de varredura por rota e tabelas extensas preservam rolagem horizontal em vez de uma prioridade de colunas uniforme.

## Direção de implementação

1. Criar tokens CSS semânticos e primitives acessíveis (Button, Input, Select, Dialog, Table, StatusBadge, PageHeader, Empty/Loading/ErrorState).
2. Construir `AppShell` e uma única fonte de navegação/metadata de rotas; incluir breadcrumb e título da aba.
3. Consolidar Agentes e Sincronização em uma seção: Provisionamento, Monitoramento e Logs.
4. Migrar a administração por página, preservando chamadas de API e permissões; não reescrever Inbox em bloco.
5. Tratar loading, sucesso, falha, conflito e alterações não salvas em toda gravação.

## Capturas antes/depois

Pendente de execução autenticada com `QA_BASE_URL` e `QA_PASSWORD` configurados no ambiente local. As capturas devem usar dados de QA, mascarar telefone/e-mail quando necessário e ocorrer somente em falhas ou comparativos explícitos de regressão visual.
