# Mavo Talk — Relatório de Evolução

**Período coberto:** 31/07 a 07/08/2026
**Produto:** Mavo Talk — central de conversas de WhatsApp (mensageria e atendimento)
**Responsável técnico:** Willy Henrique

---

## 1. Resumo executivo

O Mavo Talk é a **central de conversas de WhatsApp da Mavo**: recebe a mensagem do cliente, faz a
triagem pelo bot, distribui em filas por demanda e entrega a conversa ao atendente humano em tempo
real. O sistema está **publicado e funcionando**, com Supabase como banco oficial, operando
multiempresa com isolamento por empresa.

> **Status: pronto para produção, aguardando implantação.**
> O desenvolvimento está concluído e validado. A implantação junto ao cliente ainda não foi
> realizada porque depende da agenda do Mateus, que está com demanda alta no período.
> **Proposta: reunião de alinhamento na sexta-feira (07/08) e entrada em produção na segunda-feira
> (10/08).**

Este ciclo concentrou-se em **autonomia da operação**: colocar nas mãos da equipe comercial o que
antes dependia de desenvolvedor — cadastro de promoções, encartes, horários e as automações de cada
fila de atendimento.

**Evolução no período:**

| Indicador | 31/07 | 07/08 |
|---|---|---|
| Commits no repositório | 140 | **163** |
| Rotas de API implementadas | 62 | **68** |
| Migrations versionadas | 15 | **17** |
| Arquivos de teste | 60 | **68** |
| Testes automatizados | — | **175 aprovados, nenhuma falha** |

---

## 2. O que foi entregue neste ciclo

### 2.1 Automação de filas — a operação passa a se configurar sozinha

Cada fila de atendimento (Ofertas, Horários, Produtos, Açougue, Trocas, Atendente) ganhou um
**editor próprio no painel**. A equipe define o que o bot responde em cada fila sem depender de
alteração de código.

Antes, mudar a resposta de uma fila exigia desenvolvedor e nova publicação do sistema. Agora é
edição no painel, com efeito imediato.

### 2.2 Promoções e encartes sob controle da equipe comercial

- **Cadastro e edição de promoções** por empresa, com validade, status e mídia.
- **Histórico de conteúdo publicado** — é possível ver o que estava no ar em cada momento.
- **Snapshot do publicado**: o bot só entrega o que está efetivamente publicado e dentro da janela
  de validade, nunca um rascunho.
- **Aviso no painel** quando uma promoção cadastrada não está publicada — antes era possível
  cadastrar uma oferta e ela silenciosamente não chegar ao cliente.
- **Ordem das ofertas** corrigida: a sequência entregue ao cliente passou a respeitar a ordem
  definida pela equipe.

### 2.3 Horários e localização

Cálculo de **próxima abertura considerando múltiplos dias** — o bot informa corretamente quando a
loja reabre, inclusive atravessando fim de semana e feriado.

### 2.4 Correção de envio de mídia (encarte)

O envio de imagens estava sujeito a falha por conflito de configuração entre variáveis do provedor
de mídia. Corrigido com regra de precedência explícita, o que destravou a publicação de encartes.

### 2.5 Confiabilidade da publicação

- Migrations de banco tornadas **idempotentes** — podem ser reaplicadas sem risco.
- Aplicação e registro da migration na **mesma transação**, eliminando estado inconsistente em caso
  de falha no meio do processo.

---

## 3. Estado consolidado do produto

### Canal WhatsApp
Conexão por QR Code ou Twilio, alternável por configuração. Sessão **cifrada e persistida no banco**
— não se perde quando o servidor reinicia. Modo de homologação que percorre o fluxo completo sem
enviar mensagem real.

### Bot de atendimento
Seis jornadas fechadas, com menu numérico e linguagem natural. Regras de operação já aplicadas:
**nunca confirma preço ou estoque sem fonte confiável**, nunca pede senha ou dado bancário, e
silencia após transferir para o atendente.

### Central de atendimento
Inbox em tempo real, filas, atribuição, indicador de digitação, upload de mídia, respostas rápidas,
SLA por fila e trilha de auditoria.

### Operação comercial
Promoções, configuração de entrega com previsão persistida no pedido, e pedidos com ciclo completo
de estados (recebido → confirmado → em preparo → pronto → despachado → entregue).

### Segurança e multiempresa
A empresa é identificada **exclusivamente pela sessão autenticada**, nunca pelo conteúdo da
requisição, com uma segunda barreira no próprio banco de dados.

---

## 4. Qualidade e validação

| Verificação | Resultado |
|---|---|
| Testes automatizados | **175 aprovados**, nenhuma falha |
| Cobertura por arquivos de teste | 68 arquivos (65 unitários/integração + 3 ponta a ponta) |
| Migrations versionadas | 17, todas aditivas |

---

## 5. Obstáculos

### 5.1 Infraestrutura em plano gratuito — principal limitador

Toda a hospedagem roda em instâncias gratuitas, o que impõe limites reais:

- O serviço **hiberna após 15 minutos sem uso** e leva cerca de 1 minuto para acordar — a primeira
  mensagem do dia pode atrasar.
- Não existe plano gratuito de processo dedicado para tarefas em segundo plano, então elas rodam
  dentro do mesmo processo do site.
- A fila de tarefas não tem persistência garantida no plano gratuito.

**Impacto:** a estabilidade percebida hoje é limitada pela infraestrutura, não pelo código. É a
decisão de orçamento com maior efeito na qualidade do serviço.

### 5.2 Ausência de fonte de dados de produto

O bot **não tem acesso a estoque, preço ou encarte reais**. As promoções são cadastradas
manualmente no painel. Por decisão de projeto, consulta de disponibilidade é sempre encaminhada a um
atendente — o bot não inventa informação.

A integração com a base de produtos destrava a jornada de ofertas por completo. As rotas de
sincronização já estão implementadas e aguardam o contrato de leitura do catálogo.

### 5.3 Canal não oficial do WhatsApp

A conexão atual depende de sessão do WhatsApp Web, sujeita a reconexão e a risco de bloqueio do
número. A sessão cifrada no banco reduz a perda por reinício, mas não elimina o risco do canal.

O caminho oficial (Twilio) **já está implementado** e pode ser ativado por configuração quando
houver orçamento.

---

## 6. Plano de entrada em produção

O desenvolvimento está concluído. O que falta é **implantação**, não construção.

| Etapa | Quando | Responsável |
|---|---|---|
| Reunião de alinhamento com o Mateus | **Sexta-feira, 07/08** | Willy + Mateus |
| Entrada em produção | **Segunda-feira, 10/08** | Willy |
| Acompanhamento da primeira semana de operação | 10 a 14/08 | Willy |

**Por que ainda não foi implantado:** a implantação exige a participação do Mateus, que está com
demanda alta no período. Não há bloqueio técnico — o sistema está validado e pronto.

**O que a reunião precisa definir:** número de WhatsApp que será usado, horário de corte para a
virada, quem acompanha o primeiro dia e qual empresa entra primeiro.

---

## 7. Próximos passos após a implantação

| Prioridade | Item | Depende de |
|---|---|---|
| Alta | Consumo da base real de produtos e preços | Contrato de integração |
| Alta | Substituir promoções manuais por encarte automático | Item anterior |
| Média | Validação das seis jornadas com telefone de teste | Equipe |
| Média | Migração para o canal oficial do WhatsApp | Orçamento |
| Média | Infraestrutura dedicada (sem hibernação) | Orçamento |

---

## 8. Leitura conjunta com o Mavo AI

Mavo Talk e Mavo AI são **complementares**: o Talk é o canal — recebe, organiza e entrega a conversa
ao atendente; o AI é o cérebro de suporte técnico que responde dentro desse canal.

A integração entre os dois já está implementada e em operação.

---

*Documento gerado em 07/08/2026.*
