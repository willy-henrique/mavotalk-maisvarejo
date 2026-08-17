# Auditoria técnica de produção — Mavo Talk

Data: 17/08/2026
Ambiente observado: `https://mavo-talk-web.onrender.com`
Modo: somente leitura

## Resumo executivo

A aplicação em produção respondeu normalmente nas áreas críticas, manteve a sessão
WhatsApp persistente e não apresentou erro visível, falha HTTP, overflow horizontal
ou queda do tempo real durante a auditoria estável. Nenhuma mensagem foi enviada e
nenhum chamado, usuário, contato, pedido ou parâmetro foi alterado.

Foram encontrados dois defeitos funcionais no código e um defeito visual em
produção. As correções estão apenas no repositório local e ainda precisam ser
publicadas no Render:

1. uma mensagem nova podia rebaixar uma conversa já puxada de `em_atendimento` para
   `aguardando`;
2. o controle de assinatura podia ser sobrescrito por uma resposta tardia das
   configurações e não era aplicado ao envio de imagem;
3. a página de Pedidos mostrava o cabeçalho e o título da aba como “Caixa de entrada”.

## Verificações em produção

| Área | Endpoint crítico | HTTP | Tempo observado |
|---|---|---:|---:|
| Dashboard | `/api/dashboard/metrics` | 200 | 1.604 ms |
| Contatos | `/api/contacts` | 200 | 1.407 ms |
| Conexão WhatsApp | `/api/whatsapp/status` | 200 | 761 ms |
| Agentes | `/api/admin/agents` | 200 | 202 ms |
| Auditoria gerencial | `/api/business/audit` | 200 | 1.340 ms |
| Acessos gerenciais | `/api/admin/business-access` | 200 | 1.317 ms |
| Usuários | `/api/admin/users` | 200 | 1.301 ms |
| Filas | `/api/queues` | 200 | 1.324 ms |
| Pedidos | `/api/orders` | 200 | 1.325 ms |
| Respostas rápidas | `/api/quick-replies` | 200 | 1.780 ms |
| Visibilidade do menu | `/api/admin/menu-settings` | 200 | 2.119 ms |
| Inbox | `/api/conversations` | 200 | 1.544 ms |

Também foram confirmados:

- `/api/health` saudável;
- WhatsApp pronto, sem ação operacional pendente e com sessão persistida no banco;
- CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP e
  `X-Content-Type-Options` presentes;
- autenticação e proteção de rotas em dois tamanhos de desktop;
- Inbox em 390 × 844 sem overflow horizontal;
- navegação e conexão em tempo real estáveis no WebKit móvel;
- botão de assinatura visível, alternando estado e restaurando a configuração
  original, sem realizar envio real.

O WebKit registra cancelamentos de rede como erro quando uma navegação interrompe
uma tentativa de upgrade do Socket.IO. Um teste isolado, mantendo o Inbox parado
por dez segundos, confirmou conexão estável e console limpo; portanto, o aviso não
representa queda do tempo real.

## Correções locais

- A entrada de mensagem agora preserva `em_atendimento` e impede o rebaixamento por
  corrida diretamente no `UPDATE` do banco.
- O estado persistido é relido antes de qualquer resposta automática; se um agente
  assumiu durante o processamento, o bot não envia por cima do atendimento humano.
- A assinatura gera exatamente `Nome do atendente:\nmensagem` quando ligada e
  preserva o conteúdo quando desligada.
- Texto, resposta rápida, link e imagem usam a escolha atual do botão de assinatura.
- A interação do atendente não é mais desfeita por uma configuração carregada com
  atraso.
- A rota de Pedidos recebeu metadados próprios de cabeçalho e título.
- A sincronização da agenda também consulta e exibe fotos de perfil disponíveis,
  com concorrência limitada, cache de 24 horas e tolerância às regras de privacidade
  do WhatsApp.
- Lockfiles foram atualizados dentro das faixas já declaradas; `npm audit` ficou com
  zero vulnerabilidades conhecidas no backend e no frontend.

## Bateria local

- Testes automatizados: **219 executados, 217 aprovados, 0 falhas, 2 pulados**.
- Os 2 testes pulados são integrações que gravam/apagam dados em PostgreSQL; não
  foram apontados para a base de produção sem um banco de QA dedicado.
- TypeScript backend + frontend: aprovado.
- Build de produção Next.js: aprovado.
- Build de produção Vite: aprovado.
- `render.yaml`: validado.
- Lint dos arquivos alterados: aprovado, sem erro ou aviso.
- Lint global: 14 erros e 14 avisos preexistentes, concentrados principalmente em
  `QueueAutomationDrawer.tsx` e `UpdateAvailable.tsx`; não bloqueiam os builds, mas
  devem virar uma frente separada de saneamento técnico.

## Próximo passo seguro

Revisar e publicar as alterações em uma janela controlada. Após o deploy, fazer um
smoke test com um número de WhatsApp exclusivo para QA: puxar um chamado, receber
nova mensagem do cliente e validar que ele permanece em atendimento; depois enviar
uma mensagem com a assinatura ligada e outra desligada. Esse teste não foi feito no
cliente real para evitar mutação em produção.

Os relatórios brutos do navegador foram removidos após a análise para não reter
conteúdo ou identificadores de conversas reais.
