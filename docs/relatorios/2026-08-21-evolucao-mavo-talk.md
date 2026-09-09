# Mavo Talk — Relatório de Evolução

**Período coberto:** 17/08 a 21/08/2026 (semana útil)
**Baseline de comparação:** `797724d`, último commit de sexta 14/08
**Produto:** Mavo Talk — central de conversas de WhatsApp (mensageria e atendimento)
**Responsável técnico:** Willy Henrique
**Ambiente de produção:** `https://mavo-talk-web.onrender.com` (Render + Supabase)
**Versão do relatório:** 1

---

## 1. Resumo executivo

**Resultado principal da semana:** a semana foi de *endurecimento do que já está em
produção*, não de funcionalidade nova. Uma auditoria técnica em produção na segunda-feira
(17/08) encontrou defeitos reais de atendimento, e o restante da semana foi gasto
corrigindo-os na raiz — não no sintoma — e travando cada correção com teste automatizado.

**Maior avanço material:** três classes de defeito que corrompiam o atendimento foram
eliminadas com correção estrutural no banco, e não apenas na aplicação:

1. **Chamados duplicados por contato duplicado.** O mesmo telefone gravado em dois
   formatos (`5562…` e `whatsapp:+5562…`) gerava dois `contact_id`. Como o bloqueio de
   concorrência usa `contact_id`, os dois registros mantinham chamados abertos ao mesmo
   tempo. Corrigido com migration de consolidação que preserva o chamado mais antigo,
   move as mensagens e encerra os protocolos redundantes com razão auditável.
2. **Rebaixamento de conversa em atendimento.** Uma mensagem nova podia derrubar uma
   conversa de `em_atendimento` de volta para `aguardando`, tirando o chamado das mãos de
   quem já o havia assumido. Corrigido dentro do próprio `UPDATE`, onde a corrida
   acontecia.
3. **Assinatura do atendente divergente entre WhatsApp e painel.** Desligar a assinatura
   removia o nome da mensagem enviada ao cliente, mas o painel continuava exibindo
   `Nome do atendente:`. Cada mensagem passou a registrar se foi assinada, de modo que o
   painel repete exatamente o que o cliente viu.

**Maior pendência atual:** as correções da semana estão no repositório e validadas, porém
**a publicação em produção precisa ser confirmada**. A auditoria de 17/08 registrou que as
correções daquele dia ainda não haviam subido para o Render; os dois commits de 21/08 são
posteriores a essa constatação.

**Situação geral:** produto estável, em produção, com a base de testes crescendo mais
rápido que a base de código — 9 arquivos de teste novos contra 5 módulos novos de
aplicação. É o sinal correto para um sistema que já tem cliente atendendo por ele.

---

## 2. Números do período

| Indicador | 14/08 | 21/08 | Variação |
|---|---:|---:|---:|
| Commits no repositório | 203 | **213** | +10 |
| Rotas de API implementadas | 72 | **73** | +1 |
| Migrations versionadas | 22 | **25** | +3 |
| Arquivos de teste | 66 | **75** | +9 |
| Arquivos TypeScript | 295 | **312** | +17 |
| Testes automatizados | — | **244 coletados — 242 aprovados, 0 falhas, 2 pulados** | — |

**Volume de alteração no período:** 58 arquivos, +5.001 linhas, −597 linhas.

**Distribuição do esforço** (arquivos tocados por área):

| Área | Arquivos |
|---|---:|
| `tests/unit` | 13 |
| `app/api` | 10 |
| `frontend/components` | 6 |
| `tests/e2e` | 4 |
| `supabase/migrations` | 3 |
| `lib/` (módulos novos) | 5 |

A área mais tocada da semana foi *teste*. Isso é deliberado: cada defeito encontrado na
auditoria virou um teste antes de virar correção, para que a regressão não volte
silenciosamente.

---

## 3. Auditoria técnica de produção — 17/08

Executada em modo **somente leitura** contra o ambiente publicado. Nenhuma mensagem foi
enviada e nenhum chamado, usuário, contato, pedido ou parâmetro foi alterado.

**O que passou:** 12 endpoints críticos responderam HTTP 200; `/api/health` saudável;
sessão WhatsApp persistida no banco e pronta; cabeçalhos de segurança presentes (CSP,
HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP,
`X-Content-Type-Options`); Inbox em 390 × 844 sem overflow horizontal; tempo real estável.

| Área | Endpoint | HTTP | Tempo |
|---|---|---:|---:|
| Agentes | `/api/admin/agents` | 200 | 202 ms |
| Conexão WhatsApp | `/api/whatsapp/status` | 200 | 761 ms |
| Acessos gerenciais | `/api/admin/business-access` | 200 | 1.317 ms |
| Filas | `/api/queues` | 200 | 1.324 ms |
| Auditoria gerencial | `/api/business/audit` | 200 | 1.340 ms |
| Inbox | `/api/conversations` | 200 | 1.544 ms |
| Dashboard | `/api/dashboard/metrics` | 200 | 1.604 ms |
| Respostas rápidas | `/api/quick-replies` | 200 | 1.780 ms |
| Visibilidade do menu | `/api/admin/menu-settings` | 200 | 2.119 ms |

*(tabela abreviada; a íntegra está em `2026-08-17-auditoria-producao.md`)*

**O que falhou:** dois defeitos funcionais e um defeito visual — todos corrigidos ao longo
da semana e detalhados na seção 4.

**Observação técnica registrada:** o WebKit contabiliza cancelamento de rede como erro
quando uma navegação interrompe o upgrade do Socket.IO. Um teste isolado, mantendo o Inbox
parado por dez segundos, confirmou conexão estável e console limpo. **Não é queda de tempo
real** — é ruído de instrumentação, e ficou registrado para não ser reinvestigado.

A auditoria também produziu `tests/e2e/production-readonly.spec.ts`, que transforma esse
roteiro manual em suíte repetível.

---

## 4. Entregas do período

### 4.1 Contatos duplicados e chamados concorrentes

**Commits:** `de281b6`, `0de72d5` · **Migration:** `202608170019_deduplicate_whatsapp_contacts.sql`

O mesmo telefone entrava no sistema em dois formatos dependendo do caminho: conversa
iniciada pelo painel gravava de um jeito, resposta recebida pelo WhatsApp gravava de
outro. Resultado: dois contatos, dois chamados abertos, dois atendentes possíveis para a
mesma pessoa.

A correção é de dados, não de tela. A migration consolida os contatos, **preserva o chamado
aberto mais antigo**, move para ele as mensagens dos chamados duplicados e encerra os
protocolos redundantes com uma razão auditável. Conversas históricas continuam existindo e
passam a apontar para o contato consolidado — nada de histórico foi descartado.

### 4.2 Preservação do chamado em atendimento

**Commit:** `0de72d5` · **Módulo novo:** `lib/conversation-state.ts`

Regra explicitada em código e coberta por teste: *uma mensagem do cliente pode abrir ou
reabrir a fila, mas nunca retirar um chamado de uma pessoa que já o assumiu.*

A defesa foi colocada no `UPDATE` do banco, e não na camada de aplicação, porque era ali
que a corrida acontecia. Além disso, o estado persistido passou a ser relido antes de
qualquer resposta automática: se um agente assumiu durante o processamento, o bot não
envia por cima do atendimento humano.

### 4.3 Assinatura do atendente

**Commits:** `0de72d5`, `49becfb` · **Migration:** `202608210021_message_with_signature.sql`
**Módulo novo:** `lib/agent-message.ts`

Três problemas distintos sob o mesmo tema:

- A assinatura não era aplicada ao envio de imagem — só a texto.
- Uma resposta tardia do carregamento de configurações sobrescrevia a escolha que o
  atendente acabara de fazer no botão.
- O balão do painel imprimia `Nome do atendente:` em toda mensagem, independentemente do
  botão. Desligar a assinatura tirava o nome do WhatsApp do cliente, mas não do painel.

O terceiro exigiu coluna nova: cada mensagem passou a guardar **se foi assinada**, que é o
dado que o painel precisa para reproduzir exatamente o que o cliente recebeu. O padrão da
coluna é `TRUE` porque assinar era o comportamento fixo até aqui — as mensagens que já
existiam foram mesmo enviadas com o nome na frente.

`lib/agent-message.ts` também normaliza o nome exibido, impedindo que espaço ou quebra de
linha vindos do cadastro deformem a mensagem enviada.

### 4.4 PDFs no Inbox

**Commits:** `5fcab7d`, `d9da2b5`, `49becfb` · **Rota nova:** `app/api/media/pdf/route.ts`
**Módulo novo:** `lib/message-attachment-validation.ts`

Anexos em PDF passaram a abrir e baixar pelo painel. A entrega evoluiu dentro da própria
semana: começou permitindo abrir, restringiu para abrir somente em nova aba e terminou
servindo o arquivo por **URL assinada do Cloudinary**, que é o formato correto — o link
deixa de ser adivinhável e passa a expirar.

`lib/message-attachment-validation.ts` fixa o teto de 16 MiB e a lista de tipos aceitos.

### 4.5 Sincronização de conversas e fotos do WhatsApp

**Commits:** `9f0a6da`, `f538c08`, `98411b4`, `b73e4d0`
**Módulos novos:** `lib/whatsapp-message-history.ts`, `lib/whatsapp-contact-avatars.ts`
**Componente novo:** `frontend/components/ui/AvatarPreviewDialog.tsx`

Conversas iniciadas direto no aparelho passaram a aparecer no painel, e os contatos
ganharam foto de perfil. `98411b4` corrige um detalhe que teria sido grave em produção:
**os avatares estavam sendo gravados no tenant errado** — em um sistema multiempresa, isso
é vazamento de dado entre clientes.

### 4.6 Controle do bot por contato

**Commit:** `b73e4d0` · **Migration:** `202608170020_contact_bot_disabled.sql`

Nova coluna `contacts.bot_disabled`. Diferente de bloquear o contato: as mensagens
continuam entrando no Inbox e o atendente ainda responde manualmente — só as respostas
automáticas ficam silenciadas para aquela pessoa.

É a resposta para o caso de um cliente que não se dá bem com o menu numérico e precisa de
atendimento humano direto, sem ser bloqueado.

### 4.7 Navegação do Inbox ao puxar atendimento

**Commit:** `10ae794`

Puxar um atendimento agora leva o operador para *Abertas › Atendendo* com a conversa já
aberta. Antes, a ação executava mas deixava o atendente sem contexto visual do que tinha
acabado de assumir.

---

## 5. Banco de dados

Três migrations versionadas no período, todas com comentário de intenção e rollback
documentado no cabeçalho:

| Migration | Natureza | Reversível |
|---|---|---|
| `202608170019_deduplicate_whatsapp_contacts` | consolidação de dados | parcial — consolidação de contatos não se desfaz automaticamente |
| `202608170020_contact_bot_disabled` | coluna nova com default | sim |
| `202608210021_message_with_signature` | coluna nova com default | sim |

**Ponto de atenção sobre a 0019:** é a única migration da semana que *altera dados
existentes*, não apenas estrutura. Ela foi escrita para preservar histórico, mas uma
reversão limpa não é possível depois de aplicada. Antes de rodar em produção, confirmar
backup do Supabase do dia.

---

## 6. Qualidade e testes

**242 testes aprovados, 0 falhas, 2 pulados**, de 244 coletados. Nove arquivos de teste novos no período:

| Arquivo | Defeito que trava |
|---|---|
| `conversation-state.test.ts` | rebaixamento de conversa em atendimento |
| `agent-message.test.ts` | deformação do nome do atendente |
| `agent-signature-visibility.test.ts` | divergência de assinatura entre painel e WhatsApp |
| `cloudinary-signed-url.test.ts` | URL de mídia adivinhável |
| `pdf-signed-delivery.test.ts` | entrega de PDF sem assinatura |
| `message-attachment-validation.test.ts` | anexo acima do limite ou de tipo indevido |
| `contact-automation-policy.test.ts` | bot respondendo a contato silenciado |
| `whatsapp-contact-avatars.test.ts` | avatar gravado no tenant errado |
| `whatsapp-message-history.test.ts` | conversa do aparelho não aparecendo no painel |

Somam-se `tests/e2e/production-readonly.spec.ts` (auditoria de produção repetível) e uma
expansão de 245 linhas em `production-regressions.test.ts`.

**Leitura da métrica:** a razão teste/código da semana foi de 9 arquivos de teste para 5
módulos novos. Não é excesso — é a proporção esperada quando o trabalho é corrigir defeito
encontrado em produção, onde o teste é o que impede a volta silenciosa.

---

## 7. Frente paralela: integração com a Nuvem Core (F2)

Trabalho iniciado em 21/08, **em branch, ainda não integrado ao `main`**.

O Mavo Talk passará a consumir o catálogo de produtos que a frente F2 publica no Supabase
`mavo-hml` (pipeline `Firebird do cliente → Edge Sync → API de ingestão → Supabase`).
Com isso, a pergunta *"vocês têm café Melitta?"* deixa de ser encaminhada em branco para um
atendente: o bot confirma na hora que o item existe no cadastro da loja.

**Estado:** construído e testado contra uma réplica local do schema `mavo-hml`, com 13
testes próprios e verificação ponta a ponta da resposta ao cliente. Migrar para o Supabase
real muda apenas variável de ambiente — nenhuma linha de aplicação.

**Decisão de arquitetura registrada:** espelho local com job de sincronização, e não
leitura direta. A própria F2 declara que o canal `mavo_reader_hml` é ferramenta de
homologação, não contrato definitivo de consumo. Colocá-lo no caminho crítico de cada
mensagem de WhatsApp faria uma indisponibilidade daquela frente virar bot mudo aqui.

**Bloqueios externos** (pedido formal enviado à F2):

1. Senha do papel de leitura e certificado CA — só por canal separado.
2. `db.jrsgiiuyeqejayjgenfy.supabase.co` resolve **apenas para IPv6** e a máquina não tem
   IPv6 de saída. Necessário o Supavisor Session Pooler (IPv4). É o risco `F2-R2` que a
   própria F2 registrou.
3. `tenant_id` do Belavista ainda não definido.

**Limitação de produto que precisa ser tratada comercialmente:** o catálogo da F2 tem
`idproduto`, `descricao` e `ean` — **não tem preço nem estoque**. O bot consegue afirmar
que o item existe no cadastro; *"quanto custa?"* e *"tem em estoque?"* continuam indo para
atendente humano. Isso muda o que se pode prometer sobre o bot e está formalizado no
pedido enviado à F2.

---

## 8. Riscos, pendências e dívidas

### R1 — Publicação em produção não confirmada
**Severidade:** alta
A auditoria de 17/08 registrou que as correções daquele dia estavam **apenas no repositório
local**. Os commits de 21/08 são posteriores. Enquanto o deploy não for confirmado, o
cliente segue exposto aos defeitos já corrigidos aqui.
**Ação:** confirmar o deploy no Render e reexecutar `tests/e2e/production-readonly.spec.ts`
contra o ambiente publicado.

### R2 — Migration de consolidação sem reversão limpa
**Severidade:** média
A `202608170019` altera dados existentes. Escrita para preservar histórico, mas irreversível
na prática.
**Ação:** confirmar backup do Supabase antes de aplicar em produção.

### R3 — Colisão de numeração de migration
**Severidade:** baixa (já corrigida)
A branch da Nuvem Core criou `202608210021_mavo_cloud_catalog.sql` no mesmo dia em que o
`main` recebeu `202608210021_message_with_signature.sql`. Duas migrations com o mesmo
número quebrariam `npm run db:migrate` para quem integrasse a branch.
**Ação tomada:** a migration da branch foi renumerada para `202608210022`. **Recomendação
permanente:** conferir o último número em `main` antes de criar migration em branch de
longa duração.

### R4 — Observabilidade operacional
**Severidade:** média
Existem `/api/health` e diagnóstico técnico, mas não há alerta operacional contínuo. Hoje a
descoberta de defeito em produção depende de auditoria manual — foi assim que os defeitos
desta semana apareceram.
**Ação:** definir sinais mínimos, limiares e responsável.

### R5 — Ruído de rede do WebKit
**Severidade:** informativa
Cancelamento de upgrade do Socket.IO aparece como erro de console no WebKit móvel.
Investigado e descartado em 17/08. Registrado aqui para não consumir tempo de novo.

---

## 9. Próximos marcos

| Prioridade | Marco | Critério de aceite | Dependência |
|---:|---|---|---|
| 1 | Publicar as correções da semana no Render | `production-readonly.spec.ts` verde contra produção | janela de deploy |
| 2 | Aplicar a migration de consolidação de contatos | nenhum contato duplicado; histórico preservado | backup confirmado |
| 3 | Receber credenciais da Nuvem Core | primeiro sync real do catálogo do Belavista | resposta da F2 |
| 4 | Integrar a branch da Nuvem Core ao `main` | suíte completa verde após a integração | marco 3 |
| 5 | Definir observabilidade mínima | alertas com responsável definido | alinhamento operacional |

---

## 10. Declaração de completude

Confirmo que:

- todos os commits do período foram reportados (`797724d..10ae794`, 10 commits);
- itens sem avanço e pendências foram informados;
- as conclusões possuem commit, migration ou teste correspondente como evidência;
- os riscos conhecidos foram declarados, inclusive um introduzido por trabalho próprio (R3);
- nenhum segredo, credencial ou dado de cliente foi incluído;
- nenhum percentual de conclusão foi atribuído ao produto.

**Responsável:** Willy Henrique
**Data:** 21/08/2026

---

## Anexo — Commits do período

| Hash | Data/hora | Descrição |
|---|---|---|
| `0de72d5` | 17/08 11:49 | corrigir atendimento, assinatura e contatos |
| `de281b6` | 17/08 14:15 | corrigir WhatsApp, PDFs e chamados duplicados |
| `5fcab7d` | 17/08 14:24 | permitir abrir e baixar PDFs no inbox |
| `d9da2b5` | 17/08 14:31 | abrir PDFs somente em nova aba |
| `9f0a6da` | 17/08 16:49 | sincronizar conversas feitas no WhatsApp |
| `f538c08` | 17/08 22:12 | sincronizar fotos dos contatos do WhatsApp |
| `98411b4` | 17/08 22:27 | gravar avatares no tenant correto |
| `b73e4d0` | 17/08 22:54 | controlar bot por contato e ampliar avatares |
| `49becfb` | 21/08 12:01 | abrir PDF pela URL assinada e respeitar a assinatura no painel |
| `10ae794` | 21/08 13:58 | puxar atendimento leva para Abertas › Atendendo com a conversa aberta |
