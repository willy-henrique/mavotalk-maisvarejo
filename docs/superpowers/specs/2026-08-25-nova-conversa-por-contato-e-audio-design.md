# Nova conversa pelos contatos · Ouvir e gravar áudio

**Data:** 25/08/2026
**Origem:** pedido do cliente final
**Status:** Partes B e C implementadas em 25/08/2026. Parte A ainda no papel.

---

## O problema

Duas queixas, na mesma tela.

**Iniciar conversa exige digitar o número.** O botão "+ Nova conversa" abre um
formulário que pede DDD + número, nome e a primeira mensagem. Para falar com alguém
que já está na base — e que já tem nome, avatar e histórico — o atendente precisa
saber o telefone de cabeça ou sair da tela para procurá-lo. Palavras do cliente:
*"quando iniciar uma nova conversa, tem que abrir a aba de contatos para chamar"*.

**Não existe áudio de saída.** *"a plataforma tem que ter como de ouvir e gravar
audios"*. Gravar não existe em lugar nenhum do código. Ouvir existe no papel, mas
com dois defeitos — um deles de privacidade, descrito abaixo.

## O que já existe

Boa parte da fundação. Nada disto precisa ser construído:

- `GET /api/contacts` — lista paginada com busca por `q`, respeitando permissão de menu;
- `POST /api/contacts/[id]/start-conversation` — abre ou reusa a conversa aberta do
  contato, sem exigir mensagem;
- `POST /api/conversations/[id]/messages/upload` — recebe arquivo, valida, sobe para o
  Cloudinary, entrega no WhatsApp, grava a mensagem e emite o evento de tempo real;
- entrada de áudio no Baileys: `audioMessage` é detectado, baixado e armazenado
  (`lib/whatsapp-client.ts`), com `type: "audio"` gravado na mensagem;
- `signedDeliveryUrl(publicId, resourceType)` e `cloudinaryResourceTypeFromUrl()`
  em `lib/cloudinary.ts` — já sabem assinar recurso `video`, que é como o Cloudinary
  guarda áudio.

O que falta é ligação, não fundação.

---

## Parte A — Nova conversa começa pelos contatos

### Desenho

`StartConversationDialog` passa a ter duas abas:

**Contatos** (aba padrão) — campo de busca que consulta `GET /api/contacts?q=` com
debounce, lista com avatar, nome e telefone. Clicar no contato chama
`POST /api/contacts/[id]/start-conversation`, fecha a janela e abre a conversa
selecionada no painel, já atribuída ao atendente.

**Número novo** — o formulário de hoje, sem alteração.

### Por que as duas abas, e não só a lista

Contato só existe depois que a pessoa escreveu para a loja. Se a lista substituísse
o formulário, a operação perderia a capacidade de puxar assunto com quem nunca falou
— que é exatamente o motivo pelo qual este diálogo foi criado. As duas portas
respondem a perguntas diferentes: "falar com quem eu conheço" e "falar com um número".

### Por que não pedir a primeira mensagem na aba de contatos

O diálogo de hoje exige a mensagem porque, sem ela, não haveria nada para enviar a um
número desconhecido. Para um contato existente isso é atrito sem função: a conversa
abre e o atendente escreve no campo de sempre, com acesso a respostas rápidas,
anexos e assinatura — recursos que o campo do modal não tem.

### Fronteiras

A filtragem e a paginação da busca ficam em `frontend/services/contactPicker.ts`,
como funções puras, testáveis sem montar React. É o padrão que `inboxGrouping.ts`
estabeleceu: decidir "o que aparece e em que ordem" é decisão de produto, e ela some
quando fica diluída no meio de JSX.

O componente da aba de contatos vive em arquivo próprio
(`frontend/components/ContactPickerTab.tsx`). `StartConversationDialog` fica sendo só
o par de abas e o formulário de número.

---

## Parte B — Ouvir

### Os dois defeitos

**1. Vazamento.** O player aponta para `m.mediaUrl`, a URL pública de entrega do
Cloudinary. Qualquer pessoa com o link ouve o áudio do cliente, sem sessão. Imagem e
PDF já passam por `/api/media/signed`, que confere a sessão e confirma que a mídia
pertence àquela conversa. Áudio ficou de fora.

**2. Assinatura com o tipo errado.** `/api/media/signed` chama `generateSignedUrl()`,
que está fixo em `resource_type: "image"`. Áudio está no Cloudinary como `video`.
Assinar com o tipo errado devolve 404 — o próprio código já documenta isso em
`cloudinaryResourceTypeFromUrl`.

### Desenho

`/api/media/signed` passa a derivar o tipo do recurso da **URL guardada na mensagem**,
nunca de um parâmetro vindo do cliente. Um parâmetro de tipo seria uma alavanca para
sondar o armazenamento; a URL já está no banco e é a fonte confiável.

Isso exige trocar `getCloudinaryPublicIdsForConversation` — hoje devolve só os ids —
por uma consulta que devolva `{ publicId, mediaUrl }` da conversa. A verificação de
posse continua idêntica: o `publicId` pedido precisa pertencer àquela conversa
daquela organização.

O player de áudio passa a apontar para a rota assinada, como imagem e PDF já fazem.

### Diagnóstico antes da correção

Não está confirmado que ouvir esteja quebrado em produção — só que o caminho está
errado por construção. O plano começa por um teste que percorre o caminho real e
afirma qual URL o painel monta para uma mensagem de áudio. Se o defeito for outro,
ele aparece antes de qualquer código de correção ser escrito.

---

## Parte C — Gravar

### Desenho

O composer ganha um botão de microfone ao lado dos de imagem e link. O fluxo:

1. clicar inicia a gravação, com tempo correndo e um botão de parar;
2. parado, o atendente **ouve antes de enviar**, e pode descartar ou enviar;
3. enviar sobe o arquivo por `POST /api/conversations/[id]/messages/upload`.

Ouvir antes de enviar não é enfeite: áudio é a única mídia que o remetente não
consegue conferir antes de mandar, e um áudio errado no WhatsApp do cliente não tem
desfazer.

### A decisão central: onde o formato é resolvido

O Chrome não grava em ogg/opus — só `webm/opus`. O WhatsApp não reproduz webm. Alguém
precisa trocar o container. Note que é **remux, não transcodificação**: o codec dos
dois lados é opus, muda só a embalagem.

**Escolhido: encoder no navegador.** `opus-recorder` (WASM) grava ogg/opus direto,
carregado sob demanda ao clicar no microfone.

**Descartado: ffmpeg no servidor.** Funcionaria, e com `-c:a copy` o custo de CPU
seria desprezível. O problema não é execução, é deploy: `ffmpeg-static` acrescenta
~80MB ao `npm ci` de um build que já roda com tetos de tempo explícitos
(`timeout 900` e `timeout 1500` no `render.yaml`) porque o serviço já ficou pendurado
em "Building" antes. O plano gratuito é a restrição que define este projeto, e a
opção do servidor gasta justamente o recurso que não sobra. O peso do encoder vai
para o bundle do frontend, que é servido estático e não toca a memória da instância.

**Descartado: mandar webm cru.** Chega quebrado no celular do cliente.

### Backend

`validateMessageAttachment` passa a aceitar um terceiro tipo:

- `kind: "audio"`, mimes `audio/ogg` e `audio/opus`, placeholder `[audio]`;
- mesmo teto de 16MB dos demais anexos;
- validação por assinatura de bytes, como o PDF já faz — o container ogg começa com
  `OggS`. Confiar no `file.type` declarado seria aceitar a palavra do navegador sobre
  o conteúdo.

`buildOutboundMediaContent` passa `ptt: true` para áudio. Sem isso o WhatsApp entrega
como arquivo anexado, não como nota de voz — chega sem bolinha de play e sem onda, e
o cliente precisa baixar para ouvir.

A limpeza de mídia órfã em caso de falha de entrega precisa mapear áudio para
`resource_type: "video"`. Hoje o código só distingue `document` → `raw` e o resto →
`image`; áudio cairia em `image` e o recurso ficaria órfão no Cloudinary,
silenciosamente.

### Permissão do microfone

Negada, o botão explica o que aconteceu e como reverter, em vez de falhar calado.
Navegador sem `navigator.mediaDevices.getUserMedia` não mostra o botão — o encoder roda
sobre Web Audio API, não sobre `MediaRecorder`, então o gate é a captura, não a gravação.
A página precisa estar em HTTPS: o Render já serve assim, mas `localhost` é a única
exceção que o navegador abre no desenvolvimento.

---

## Testes

Todos em `tests/unit`, executados por `npm test`, sem React — o padrão do projeto.

- **anexo de áudio**: aceita ogg/opus válido; recusa arquivo que se declara ogg mas
  não tem a assinatura `OggS`; recusa acima de 16MB.
- **conteúdo Baileys**: áudio sai com `ptt: true`; imagem e documento continuam como
  estão.
- **limpeza de órfão**: áudio mapeia para `video`.
- **rota assinada**: resolve `video` para áudio e `raw`/`image` para o que já
  funcionava; recusa `publicId` de outra conversa.
- **busca de contatos**: filtro e paginação.

Gravação em si (captura do microfone, permissão, WASM) não entra em teste unitário —
é API de navegador. Fica para verificação manual no painel, listada na entrega.

---

## Fora de escopo

- **Transcrição de áudio para texto.** Seria útil para a triagem por IA que já existe
  no projeto, mas é outro problema, com outro custo.
- **Áudio no bot.** O bot continua respondendo só em texto.
- **Gravação no celular do atendente.** O painel é usado no desktop; suporte móvel ao
  microfone entra se for pedido.

## O que a implementação descobriu

Duas coisas que o desenho não previu, e que teriam feito o gravador falhar em
produção enquanto funcionava no desenvolvimento:

**`Permissions-Policy: microphone=()`** no `render.yaml`. Lista vazia proíbe o
microfone inclusive para a própria origem: `getUserMedia` seria rejeitado antes
de o navegador perguntar qualquer coisa ao atendente. Corrigido para
`microphone=(self)`; câmera, geolocalização e pagamento continuam bloqueados.

**CSP sem `'wasm-unsafe-eval'`**, em dois lugares: o header do site estático e
uma meta tag no `frontend/index.html`. Os dois são aplicados, e vale o mais
restritivo de cada diretiva — corrigir só um lado deixaria o encoder bloqueado
do mesmo jeito. Ambos ganharam `'wasm-unsafe-eval'` e `worker-src 'self'`.
`'wasm-unsafe-eval'` permite instanciar WebAssembly e **não** libera `eval()`
de JavaScript.

Verificado no navegador, sob o CSP real: WebAssembly instancia, o Worker de
mesma origem é criado, o `opus-recorder` carrega e nenhuma violação de CSP
aparece no console.

Sobre o Baileys 7: `ptt: true` basta. A duração sai do `music-metadata`, que já
vem instalado; a waveform depende do `audio-decode`, que é peer opcional e não
está instalado — a falha é capturada e registrada, e a nota de voz vai assim
mesmo, sem as barrinhas.

## Ordem de implementação

As três partes são independentes e podem ser entregues separadamente. Sugestão:

1. **Parte A** — menor, sem risco, resolve o incômodo mais imediato;
2. **Parte B** — corrige um vazamento; deve vir antes de aumentar o uso de áudio;
3. **Parte C** — a maior, e a única que traz dependência nova.
