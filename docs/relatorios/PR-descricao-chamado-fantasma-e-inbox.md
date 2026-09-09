# Corrige chamado fantasma e organiza a Caixa de entrada por fila

Dois trabalhos independentes, em commits separados. Cada um passa a suíte sozinho.

---

## 1. Chamado fantasma ao finalizar atendimento (`890d461`)

**O sintoma.** Ao finalizar um atendimento com pesquisa de satisfação, um chamado
continuava aparecendo em *Abertas*, com a própria mensagem de despedida como último
texto.

**A causa.** O aviso de encerramento e o agradecimento pela avaliação saem do próprio
número e voltam do WhatsApp como `fromMe`. Esse eco caía em
`processOutboundMessageFromDevice`, que resolvia a conversa por
`getOrCreateOpenConversation` — função que só enxerga `aguardando`,
`em_atendimento` e `pendente_cliente`.

Como o chamado acabara de virar `encerrado`, nenhuma conversa aberta era encontrada
e o caminho de criação abria **uma conversa nova em `aguardando`** só para hospedar a
despedida.

O chamado original ia corretamente para *Resolvidos*. O que aparecia em *Abertas* era
um fantasma.

As guardas de `encerrado` que já existiam no arquivo não pegavam o caso porque rodam
**depois** da criação e inspecionam justamente a conversa recém-criada.

**A correção.** O destino do eco passa a ser decidido antes de qualquer criação:

| Situação | Antes | Agora |
|---|---|---|
| Bot + conversa encerrada | criava chamado novo | anexa à encerrada |
| Bot + conversa aberta | anexava | anexa |
| Bot + sem conversa | criava chamado | descarta com log |
| Pessoa pelo aparelho | abria chamado | abre chamado (inalterado) |

**Verificação.** 4 testes de comportamento escritos antes da correção, mais 1 teste de
regressão que trava a ordem (decidir antes de criar). Verificado também contra
PostgreSQL 17 real: a conversa encerrada é encontrada, o eco se anexa a ela, nenhuma
conversa aberta é criada, e funciona com telefone no formato legado.

**Atenção — os fantasmas já existentes não somem sozinhos.** O código impede novos.
Para os que já estão no banco há `scripts/limpeza-chamados-fantasma.sql`, com
diagnóstico somente-leitura primeiro e correção depois. Ele **encerra** com motivo
auditável em vez de apagar, para não destruir a evidência do defeito. Rodar só após
conferir o resultado do diagnóstico e com backup do Supabase confirmado.

---

## 2. Caixa de entrada organizada por fila e por dono (`2910c90`)

Pedido do cliente final: separar as conversas por departamento, para que quem atende
uma fila não veja misturado o que é de outra.

**Escopo confirmado com o cliente: organização visual, sem restrição de acesso.** Todo
atendente continua enxergando toda conversa. Separar *acesso* exigiria vínculo
usuário↔fila e filtro no servidor — feito só na tela, seria vazamento com aparência de
funcionalidade.

**O que muda:**

- Lista agrupada por fila, com cabeçalho colorido e contagem.
- **"Sem fila" fixo no topo** — é a triagem, gente que escreveu e ficou parada sem
  dono. O grupo que mais precisa de olho e o que mais facilmente seria esquecido no
  fim da lista.
- Demais grupos na ordem de `menu_option`, a mesma que o cliente viu no WhatsApp.
- Grupos recolhíveis, com a escolha guardada por atendente.
- **Nova aba MINHAS**, com os chamados em aberto que o atendente puxou. A aba ABERTAS
  carrega o contador para que quem trabalha em MINHAS perceba movimento na fila geral
  sem trocar de aba.
- Filtros de Situação e Fila reunidos em **um menu só**.

**Sobre o menu.** A primeira versão usou fileiras de chips e ficou poluída: em coluna
estreita quebravam em três linhas e empurravam a primeira conversa para fora da tela,
além de cortar a aba RESOLVIDOS. De ~218px de controles para ~72px.

Detalhes que só apareceram testando na tela:

- a altura do menu é **medida na abertura**, não fixa — um teto em `rem` grande o
  bastante para dez filas passaria do rodapé em janela baixa, deixando as últimas
  filas inalcançáveis;
- escolher fecha o menu: quem atende quer filtrar e seguir;
- o filtro ativo aparece fora do menu, senão vira lista vazia sem explicação;
- os contadores mostram `12+` quando a carga bate no teto de 80 do servidor, em vez de
  exibir um número que pode estar errado.

**Verificação.** 15 testes de comportamento em `frontend/services/inboxGrouping.ts`,
sem React, mais 3 de fiação que impedem alguém de reinventar o filtro dentro do JSX ou
voltar a espalhar chips pelo cabeçalho. Conferido na tela com a aplicação rodando:
ordem dos grupos, troca de aba, filtro por fila, composição status+fila, preservação
das contagens ao filtrar, recolhimento e persistência após recarregar.

---

## O que **não** está neste PR

A integração com a Nuvem Core (catálogo de produtos do Supabase `mavo-hml`) ficou de
fora de propósito: está construída e testada, mas **bloqueada** esperando credencial e
certificado do Heitor, além de um caminho IPv4 até o banco. Junto com ela ficou de fora
a migration `202608210022_mavo_cloud_catalog.sql`.

Como o Render roda `db:migrate` no build, incluí-la aqui aplicaria schema em produção
por causa de uma funcionalidade que ainda não pode ser usada.

---

## Verificação consolidada

- **267 testes, 265 aprovados, 0 falhas, 2 pulados** (eram 244 na `main`).
- Typecheck limpo no backend e no frontend.
- Nenhuma migration: este PR não altera o schema de produção.
