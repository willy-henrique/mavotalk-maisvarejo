# Bot de supermercado — Mavo

O Mavo é o assistente virtual do Mavo Talk para atendimento de supermercado no WhatsApp. O fluxo foi desenhado para resolver dúvidas recorrentes rapidamente e transferir para uma pessoa quando preço, estoque ou análise financeira exigirem confirmação.

## Jornada do cliente

1. **Ofertas e promoções** — entrega o texto, link e/ou imagem publicados no painel.
2. **Horários e localização** — informa funcionamento, endereço, mapa e telefone.
3. **Produtos e disponibilidade** — coleta produto, marca e tamanho antes de encaminhar.
4. **Açougue, padaria e hortifruti** — coleta setor, item, quantidade ou encomenda.
5. **Trocas, devoluções e pagamentos** — coleta um resumo e número de comprovante, sem pedir dados bancários sensíveis.
6. **Falar com um atendente** — transfere diretamente para a equipe.

O cliente também pode escrever frases como “tem café de 500 g?”, “qual o horário?” ou “quero falar com o gerente”. O Mavo identifica essas intenções sem obrigar a navegação por números.

## Regras de segurança e operação

- O bot nunca confirma preço ou estoque sem uma fonte confiável; esses casos são passados à equipe.
- O bot nunca solicita senha, código do cartão ou outros segredos bancários.
- Depois da transferência, novas mensagens ficam em silêncio para o atendente assumir sem respostas repetitivas.
- `0` reabre o menu a qualquer momento.
- Fora do expediente, a mensagem é registrada e o cliente recebe um aviso claro.
- As filas usam SLA próprio e recebem o contexto digitado pelo cliente.

## Ativação

Copie as variáveis de supermercado de `.env.example` para o `.env` e preencha os dados reais da loja. Reinicie o Mavo Talk depois de alterar o arquivo.

Com `SUPERMARKET_BOT_ENABLED=true` e `SUPERMARKET_AUTO_APPLY_PRESET=true`, o primeiro atendimento sincroniza automaticamente as seis filas. A operação é idempotente: filas 1–6 são mantidas e filas fora do modelo são pausadas, não apagadas.

Também é possível reaplicar manualmente em **Demandas e filas → Aplicar menu de supermercado**. Apenas administradores e gestores podem executar essa ação.

Para preservar uma configuração de filas personalizada, use:

```env
SUPERMARKET_AUTO_APPLY_PRESET=false
```

Nesse caso, aplique o modelo pelo painel antes de habilitar o bot.

## IA opcional

O padrão seguro é `SUPERMARKET_AI_FALLBACK_ENABLED=false`: mensagens desconhecidas mostram o menu novamente. Ao definir `true`, intenções que o Mavo não reconhecer seguem para o fluxo de IA/Cérebro já configurado no projeto.

## Roteiro rápido de homologação

Use `WILLTALK_DRY_RUN_WHATSAPP=true` para testar sem enviar mensagens reais. Valide, com um telefone de teste:

- `oi` — deve abrir o menu completo;
- `ofertas` — deve responder com o encarte configurado;
- `2` — deve mostrar horário e localização;
- `tem café de 500 g?` — deve pedir marca/tamanho e preparar a fila de produtos;
- uma segunda mensagem com os detalhes — deve concluir a transferência;
- dúvidas sobre compras ou comprovantes — devem seguir para a equipe humana, sem uma opção de delivery no menu;
- `falar com atendente` — deve entrar na fila de atendimento humano;
- `0` — deve voltar ao menu.

Antes da entrada em produção, confirme o QR/Twilio conectado, os horários cadastrados no painel/banco, URLs públicas válidas e o recebimento das conversas pelos atendentes.
