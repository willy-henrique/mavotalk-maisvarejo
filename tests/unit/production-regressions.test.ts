import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("falha do provedor impede persistência enganosa da mensagem de saída", async () => {
  const route = await read("app/api/conversations/[id]/messages/route.ts");
  const failureResponse = route.indexOf("Failed to deliver outbound WhatsApp message");
  const persistence = route.indexOf("const message = await addOutboundMessage");
  assert.ok(failureResponse >= 0);
  assert.ok(persistence > failureResponse);
  assert.match(route, /status:\s*503/);
});

test("upload valida imagem/PDF, persiste MIME e remove órfão quando a entrega falha", async () => {
  const route = await read("app/api/conversations/[id]/messages/upload/route.ts");
  assert.match(route, /MAX_MESSAGE_ATTACHMENT_BYTES/);
  assert.match(route, /validateMessageAttachment/);
  assert.match(route, /attachment\.mimeType/);
  assert.match(route, /attachment\.fileName/);
  assert.match(route, /attachment\.kind === "document" \? "raw" : "image"/);
  assert.match(route, /status:\s*413/);
  assert.match(route, /status:\s*503/);
});

test("mídia assinada exige vínculo da conversa com o tenant autenticado", async () => {
  const route = await read("app/api/media/signed/route.ts");
  assert.match(route, /conversationId/);
  assert.match(route, /auth\.session\.organizationId/);
  assert.match(route, /getCloudinaryPublicIdsForConversation/);
  assert.match(route, /allowedPublicIds\.includes\(publicId\)/);
});

test("visualizador de PDF usa mensagem vinculada ao tenant e não aceita URL do cliente", async () => {
  const [route, inbox, indexHtml] = await Promise.all([
    read("app/api/media/pdf/route.ts"),
    read("frontend/components/InboxConversations.tsx"),
    read("frontend/index.html"),
  ]);
  assert.match(route, /requireMenuPermission\(auth\.session, "inbox", "read"\)/);
  assert.match(route, /getMessageMediaForConversation/);
  assert.match(route, /auth\.session\.organizationId/);
  assert.match(route, /url\.hostname === "res\.cloudinary\.com"/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /application\/pdf/);
  assert.match(route, /shouldDownload \? "attachment" : "inline"/);
  assert.match(inbox, /\/api\/media\/pdf\?/);
  assert.match(inbox, /const downloadPdf/);
  assert.match(inbox, /backendRouteNotDeployed/);
  assert.match(inbox, /url\.hostname === 'res\.cloudinary\.com'/);
  assert.match(inbox, /validatedPdfBlob/);
  assert.match(inbox, /window\.open\('', '_blank'\)/);
  assert.match(inbox, /pdfTab\.location\.replace\(url\)/);
  assert.match(inbox, /O navegador bloqueou a nova aba/);
  assert.match(inbox, /Baixar PDF:/);
  assert.doesNotMatch(inbox, /<iframe/);
  assert.doesNotMatch(inbox, /<object/);
  assert.match(inbox, /application\/pdf,\.pdf/);
  assert.doesNotMatch(indexHtml, /frame-src/);
  assert.match(indexHtml, /name="mobile-web-app-capable" content="yes"/);
});

test("nova conversa envia para o JID verificado e grava o telefone canônico", async () => {
  const [route, client, repository] = await Promise.all([
    read("app/api/conversations/route.ts"),
    read("lib/whatsapp-client.ts"),
    read("lib/supabase-repo.ts"),
  ]);
  assert.match(route, /resolveWhatsappDestination\(inputPhone\)/);
  assert.match(route, /const phone = destination\.phone/);
  assert.match(route, /destinationJid: destination\.jid/);
  assert.ok(
    route.indexOf("externalId = await sendWhatsappMessage") <
      route.indexOf("const persisted = await addOutboundMessage"),
  );
  assert.match(route, /stage: "createConversation"/);
  assert.match(route, /stage: "sendMessageToGateway"/);
  assert.match(route, /stage: "updateStatusLocal"/);
  assert.match(client, /sock\.onWhatsApp\(\.\.\.candidates\)/);
  assert.match(client, /jid: match\.jid/);
  assert.match(repository, /whatsappPhoneStorageAliases\(canonicalPhone\)/);
  assert.match(repository, /existingPhone !== contactPhone/);
});

test("contato legado não pode manter um segundo chamado aberto para o mesmo número", async () => {
  const [repository, migration, verification] = await Promise.all([
    read("lib/supabase-repo.ts"),
    read(
      "supabase/migrations/202608170019_deduplicate_whatsapp_contacts.sql",
    ),
    read("scripts/db-verify.mjs"),
  ]);

  // Em produção o mesmo telefone aparecia como `5562...` e
  // `whatsapp:+5562...`, cada formato com um contact_id e um protocolo aberto.
  assert.match(repository, /whatsappPhoneStorageAliases\(canonicalPhone\)/);
  assert.match(repository, /\.order\("created_at", \{ ascending: true \}\)/);
  assert.match(repository, /ON CONFLICT DO NOTHING/);
  assert.match(
    repository,
    /Contato concorrente não encontrado após conflito de identidade/,
  );

  // A correção dos registros existentes preserva o protocolo original e reúne
  // nele as mensagens, sem apagar o rastro do protocolo redundante.
  assert.match(migration, /regexp_replace\(phone_number, '\\D', '', 'g'\)/);
  assert.match(migration, /ORDER BY conversation\.created_at ASC/);
  assert.match(
    migration,
    /SET conversation_id = keeper_conversation_id/,
  );
  assert.match(
    migration,
    /Chamado duplicado consolidado automaticamente em #/,
  );
  assert.match(migration, /SET contact_id = keeper_contact_id/);
  assert.match(migration, /idx_contacts_org_phone_digits/);
  assert.match(migration, /CREATE UNIQUE INDEX/);
  assert.match(verification, /duplicateContactPhoneGroups/);
  assert.match(verification, /duplicateOpenConversationGroups/);
  assert.match(verification, /phoneIdentityIndexExists/);
});

test("mensagem acumulada durante reconexão entra no Inbox sem resposta atrasada", async () => {
  const [client, route] = await Promise.all([
    read("lib/whatsapp-client.ts"),
    read("app/api/webhooks/n8n/ticket-upsert/route.ts"),
  ]);
  assert.match(client, /const isPreConnectionQueued/);
  assert.match(client, /suppressReply: isPreConnectionQueued/);
  assert.doesNotMatch(client, /Skipping pre-connection queued message/);
  assert.match(client, /whatsappMessageProcessingTail/);
  assert.match(route, /"suppress_reply"/);
  assert.match(route, /mensagem_recuperada_apos_reconexao_sem_resposta_automatica/);
});

test("novo contato após encerramento cria protocolo novo", async () => {
  const repository = await read("lib/supabase-repo.ts");
  const openHelper = repository.slice(
    repository.indexOf("async function getOpenConversation"),
    repository.indexOf("export async function getOpenConversationByContactId"),
  );
  assert.doesNotMatch(openHelper, /lastConv|status:\s*"aguardando"/);
  assert.match(openHelper, /\.in\("status", \["aguardando", "em_atendimento", "pendente_cliente"\]\)/);
});

test("contatos bloqueados são filtrados nos três canais de entrada", async () => {
  const sources = await Promise.all([
    read("lib/whatsapp-client.ts"),
    read("app/api/webhooks/twilio/route.ts"),
    read("app/api/webhooks/n8n/ticket-upsert/route.ts"),
  ]);
  for (const source of sources) {
    assert.match(source, /getContactInboundPolicy/);
    assert.match(source, /\.blocked/);
  }
});

test("QR e diagnóstico do WhatsApp são restritos por permissão de painel no servidor", async () => {
  const [route, settings] = await Promise.all([
    read("app/api/whatsapp/status/route.ts"),
    read("lib/menu-settings.ts"),
  ]);
  assert.match(route, /requireMenuPermission\(auth\.session, "painel", "read"\)/);
  assert.match(settings, /painel: \{ read: CAN_MANAGE/);
});

test("desconectar desloga o aparelho e apaga a sessão antes de um novo QR", async () => {
  const [client, route] = await Promise.all([
    read("lib/whatsapp-client.ts"),
    read("app/api/whatsapp/disconnect/route.ts"),
  ]);

  // O painel precisa pedir o desligamento completo: só encerrar o socket mantém as
  // credenciais registradas e o Baileys reconecta sozinho no número anterior.
  assert.match(route, /destroyWhatsappClient\(\{\s*logout:\s*true\s*\}\)/);

  const destroy = client.slice(client.indexOf("export async function destroyWhatsappClient"));
  assert.match(destroy, /sock\.logout\(\)/);
  assert.match(destroy, /clearWhatsappAuthState\(\)/);

  // A limpeza da sessão persistida precisa acontecer depois do logout, senão o
  // socket ainda vivo regrava as credenciais que acabaram de ser removidas.
  assert.ok(destroy.indexOf("sock.logout()") < destroy.indexOf("clearWhatsappAuthState()"));

  // Um `creds.update` atrasado do socket antigo ressuscitaria a sessão apagada.
  assert.match(client, /if \(generation !== currentWhatsappGeneration\(\)\) return;\s*void saveCreds\(\)/);

  // Falha ao limpar não pode ser reportada como sucesso: o QR seguinte reconectaria o número antigo.
  assert.match(route, /status:\s*500/);
});

test("pareamento por telefone cobre o aparelho sem camera utilizavel", async () => {
  const [client, route, painel] = await Promise.all([
    read("lib/whatsapp-client.ts"),
    read("app/api/whatsapp/pairing-code/route.ts"),
    read("frontend/components/Painel.tsx"),
  ]);

  const pairing = client.slice(client.indexOf("export async function requestWhatsappPairingCode"));
  assert.match(pairing, /sock\.requestPairingCode\(digits\)/);

  // O WhatsApp só emite código para credenciais ainda não registradas: pedir sobre
  // uma sessão viva devolveria erro cru do Baileys em vez de instrução acionável.
  assert.match(pairing, /status === "ready"/);
  assert.match(pairing, /creds\?\.registered/);

  // O código só pode ser pedido na janela em que o socket está no ar e aguardando
  // registro, sinalizada pelo status "qr".
  assert.match(pairing, /getState\(\)\.status === "qr"/);

  // Exibir QR e código ao mesmo tempo confunde: pedir o código invalida o QR.
  assert.match(pairing, /qrDataUrl = null/);

  assert.match(route, /requireMenuPermission\(auth\.session, "painel", "update"\)/);
  assert.match(painel, /\/api\/whatsapp\/pairing-code/);
});

test("pareamento abandonado nao deixa a sessao presa no ramo de login", async () => {
  const client = await read("lib/whatsapp-client.ts");

  // creds.me tambem e preenchido pelo pair-success do fluxo QR, antes do restart.
  // Discriminar por creds.me apagaria uma sessao recem-pareada com sucesso, entao o
  // gatilho e creds.pairingCode, gravado apenas por requestPairingCode.
  assert.match(client, /Boolean\(authState\.creds\?\.pairingCode\) &&\s*!authState\.creds\?\.registered/);
  assert.doesNotMatch(client, /const abandonedPairing =\s*\n?\s*Boolean\(authState\.creds\?\.me\)/);

  // O restart (515) apos pareamento bem-sucedido nunca pode ser tratado como abandono.
  assert.match(client, /restartRequired = statusCode === DisconnectReason\.restartRequired/);
  assert.match(client, /!restartRequired &&/);

  // Uma sessao ja gravada nesse estado precisa se recuperar sozinha no proximo init.
  assert.match(
    client,
    /creds\.pairingCode && !auth\.state\.creds\.registered[\s\S]{0,320}clearSession\(\)/,
  );

  // Os refs de QR padrao esgotam em ~2min e derrubam o socket antes de dar tempo de
  // digitar o codigo no celular. A duracao por modo e coberta no teste da janela.
  assert.match(client, /qrTimeout:/);
});

test("cliente se anuncia como navegador reconhecido pelo WhatsApp", async () => {
  const client = await read("lib/whatsapp-client.ts");

  // getCompanionWebClientType (Utils/companion-reg-client-utils) so mapeia
  // Chrome/Edge/Firefox/IE/Opera/Safari/Desktop; qualquer outro nome vira
  // OTHER_WEB_CLIENT no link_code_companion_reg e o pareamento por numero e recusado.
  assert.match(client, /browser: Browsers\.ubuntu\("Chrome"\)/);

  // O nome da sessao e chave da sessao persistida, nao identidade de navegador.
  assert.doesNotMatch(client, /Browsers\.appropriate\(/);
  assert.doesNotMatch(client, /browser:[^\n]*WHATSAPP_SESSION_NAME/);
});

test("codigo de pareamento nasce em socket novo, com a janela cheia", async () => {
  const client = await read("lib/whatsapp-client.ts");
  const pairing = client.slice(client.indexOf("export async function requestWhatsappPairingCode"));

  // O socket criado no boot por WHATSAPP_AUTO_CONNECT pode ter consumido quase todos
  // os refs de QR. Reaproveita-lo faz o codigo herdar so o tempo restante.
  assert.match(pairing, /destroyWhatsappClient\(\)[\s\S]{0,200}initWhatsappClient\(\{ pairingMode: true \}\)/);

  // Em pairingMode o QR nao e exibido, entao refs longos so esticam a janela.
  assert.match(client, /qrTimeout: pairingMode \? WA_PAIRING_QR_TIMEOUT_MS : WA_QR_TIMEOUT_MS/);
  assert.match(client, /WA_PAIRING_QR_TIMEOUT_MS =\s*Number\(process\.env\.WA_PAIRING_QR_TIMEOUT_MS\) \|\| 60_000/);
});

test("foco de dialogos nao e reaplicado a cada render", async () => {
  const [dialog, drawer] = await Promise.all([
    read("frontend/components/ui/Dialog.tsx"),
    read("frontend/components/Admin/QueueAutomationDrawer.tsx"),
  ]);

  // onClose chega como arrow inline e muda de identidade a cada render do pai;
  // hasUnsavedChanges vira true assim que o operador digita. Com qualquer um deles
  // nas dependencias, o efeito refaz o setup a cada tecla e rouba o foco do campo.
  const dialogEffect = dialog.slice(dialog.indexOf("const previousFocus"));
  assert.match(dialogEffect, /\}, \[\]\);/);
  assert.doesNotMatch(dialogEffect, /\}, \[onClose\]\);/);
  assert.match(dialog, /onCloseRef\.current\(\)/);

  const drawerEffect = drawer.slice(drawer.indexOf("closeButtonRef.current?.focus()"));
  assert.match(drawerEffect, /\}, \[\]\);/);
  assert.doesNotMatch(drawerEffect, /\}, \[hasUnsavedChanges, onClose\]\);/);
});

test("resposta humana pelo proprio WhatsApp desliga o bot", async () => {
  const client = await read("lib/whatsapp-client.ts");
  const outbound = client.slice(
    client.indexOf("async function processOutboundMessageFromDevice"),
    client.indexOf("async function handleInboundViaBotTriagem"),
  );

  // A regra vale para qualquer resposta escrita por uma pessoa, nao so quando a loja
  // abre a conversa: o atendente que responde pelo aplicativo tambem encerra a triagem.
  assert.match(outbound, /if \(!fromBot && conversation\.status !== "encerrado"\)/);
  assert.match(outbound, /triageCompleted: true/);
  assert.doesNotMatch(outbound, /if \(conversation\.isNew && !fromBot\) \{/);
});

test("despedida do bot nao abre chamado fantasma depois do encerramento", async () => {
  const client = await read("lib/whatsapp-client.ts");
  const outbound = client.slice(
    client.indexOf("async function processOutboundMessageFromDevice"),
    client.indexOf("async function handleInboundViaBotTriagem"),
  );

  // O destino do eco precisa ser decidido antes de qualquer criacao. As guardas de
  // `encerrado` que existiam adiante inspecionavam a conversa recem-criada e por isso
  // nunca disparavam: o aviso de encerramento e o agradecimento pela avaliacao
  // nasciam em um chamado novo em `aguardando`.
  assert.match(outbound, /resolveOutboundEchoTarget\(\{/);
  assert.ok(
    outbound.indexOf("resolveOutboundEchoTarget") <
      outbound.indexOf("getOrCreateContactAndOpenConversation"),
    "a decisao do eco precisa vir antes do caminho que cria conversa",
  );

  // Mensagem do proprio bot so pode se anexar ao historico existente.
  assert.match(outbound, /latestConversation: fromBot/);
  assert.match(outbound, /getLatestConversationByPhone\(organizationId, toPhone\)/);
  assert.match(outbound, /echoTarget\.action === "skip"/);
});

test("conversas feitas no aplicativo do WhatsApp são espelhadas no Inbox", async () => {
  const [client, statusRoute] = await Promise.all([
    read("lib/whatsapp-client.ts"),
    read("app/api/whatsapp/status/route.ts"),
  ]);
  const outbound = client.slice(
    client.indexOf("async function processOutboundMessageFromDevice"),
    client.indexOf("async function handleInboundViaBotTriagem"),
  );
  const history = client.slice(
    client.indexOf('sock.ev.on("messaging-history.set"'),
    client.indexOf('sock.ev.on("contacts.upsert"'),
  );
  const historicalInbound = client.slice(
    client.indexOf("async function processHistoricalInboundMessage"),
    client.indexOf("async function handleInboundViaBotTriagem"),
  );

  // O eco do próprio painel e lotes repetidos do histórico não podem duplicar a
  // conversa ou a mensagem.
  assert.match(outbound, /findMessageByExternalId\(organizationId, externalId\)/);
  assert.match(outbound, /resolveDeviceMessagePhone\(sock, msg,/);

  // O Baileys entrega mensagens recuperadas em um evento separado do upsert ao
  // vivo. Entrada histórica é persistida sem acionar respostas atrasadas; saída é
  // processada como mensagem feita em outro dispositivo.
  assert.match(history, /history\.messages \|\| \[\]/);
  assert.match(history, /selectRecentWhatsappHistoryMessages/);
  assert.match(history, /historical: true/);
  assert.match(history, /processHistoricalInboundMessage\(sock, msg\)/);
  assert.match(historicalInbound, /addInboundMessage/);
  assert.doesNotMatch(historicalInbound, /invokeTicketUpsertLocal/);
  assert.doesNotMatch(historicalInbound, /rateLimitedSend/);

  // O endpoint autenticado permite distinguir evento não recebido, JID sem
  // resolução e falha de persistência sem expor texto ou telefone do cliente.
  assert.match(statusRoute, /getWhatsappMessageSyncDiagnostics/);
  assert.match(client, /outboundDeviceMessagesUnresolved/);
  assert.match(client, /lastOutboundDevicePersistedAt/);
});

test("envio automatico desiste se um atendente assumiu no meio do caminho", async () => {
  const route = await read("app/api/webhooks/n8n/ticket-upsert/route.ts");
  const send = route.slice(route.indexOf("SEND REPLY VIA WHATSAPP"));

  // A decisao e tomada no inicio do pedido e o envio ocorre no fim; sem reler o estado
  // aqui, o bot ainda dispara uma vez por cima da conversa humana.
  assert.match(send, /getConversation\(organizationId, String\(conversation\.id\)\)/);
  assert.match(send, /humanTookOver/);
  assert.ok(send.indexOf("humanTookOver") < send.indexOf("deliverInOrder"));
});

test("mensagem nova não rebaixa chamado já puxado para aguardando", async () => {
  const [route, repository] = await Promise.all([
    read("app/api/webhooks/n8n/ticket-upsert/route.ts"),
    read("lib/supabase-repo.ts"),
  ]);

  // O caminho humano precisa sair da automação antes do ramo do bot/IA.
  const humanBranch = route.indexOf("if (humanHandling)");
  const botBranch = route.indexOf("else if (supermarketDecision)");
  assert.ok(humanBranch >= 0 && botBranch > humanBranch);
  assert.match(route, /conversationStatus = "em_atendimento"/);

  // Além da checagem em memória, o UPDATE é condicional no banco. Isso cobre a
  // corrida em que o atendente puxa o ticket depois da leitura feita pelo webhook.
  assert.match(route, /preserveActiveStatus: true/);
  assert.match(repository, /options\?\.preserveActiveStatus/);
  assert.match(repository, /\.neq\("status", "em_atendimento"\)/);
});

test("botão de assinatura controla texto, link e imagem do compositor", async () => {
  const [textRoute, uploadRoute, inbox] = await Promise.all([
    read("app/api/conversations/[id]/messages/route.ts"),
    read("app/api/conversations/[id]/messages/upload/route.ts"),
    read("frontend/components/InboxConversations.tsx"),
  ]);

  assert.match(textRoute, /buildAgentWhatsappMessage/);
  assert.match(textRoute, /parsed\.data\.withSignature/);
  assert.match(uploadRoute, /formData\.get\("withSignature"\)/);
  assert.match(uploadRoute, /buildAgentWhatsappMessage/);
  assert.match(inbox, /formData\.append\('withSignature', String\(signatureOn\)\)/);
  assert.match(inbox, /signatureTouchedRef/);
  // É o botão azul com lápis mostrado em prints/Screenshot_1.png.
  assert.match(inbox, /aria-label="Alternar assinatura com o nome do atendente"/);
  assert.match(inbox, /Assinatura ligada: o cliente vê seu nome antes da mensagem/);
  assert.match(inbox, /onClick=\{toggleSignature\}/);
});

test("sincronização da agenda busca e exibe fotos de perfil com limite", async () => {
  const [
    whatsapp,
    repository,
    contacts,
    inbox,
    statusRoute,
    syncRoute,
    packageJson,
  ] = await Promise.all([
    read("lib/whatsapp-client.ts"),
    read("lib/supabase-repo.ts"),
    read("frontend/components/Contacts.tsx"),
    read("frontend/components/InboxConversations.tsx"),
    read("app/api/whatsapp/status/route.ts"),
    read("app/api/contacts/sync-whatsapp/route.ts"),
    read("package.json"),
  ]);

  assert.match(whatsapp, /scheduleWhatsappContactAvatarSync/);
  assert.match(
    whatsapp,
    /sock\.profilePictureUrl\(jid, "image", WA_CONTACT_AVATAR_TIMEOUT_MS\)/,
  );
  assert.match(whatsapp, /WA_CONTACT_AVATAR_CONCURRENCY/);
  assert.match(whatsapp, /recentlySyncedAvatarAt\.clear\(\)/);
  assert.match(whatsapp, /listContactPhoneNumbersForAvatarSync/);
  assert.match(whatsapp, /"manual-contact-resync"/);
  assert.match(whatsapp, /avatarJidForMessage\(msg, fromPhone\)/);
  assert.match(whatsapp, /resolveWhatsappDataOrganizationId/);
  assert.match(
    whatsapp,
    /updateWhatsappContactAvatarsByPhone\(targetOrganizationId, updates\)/,
  );
  assert.match(repository, /updateWhatsappContactAvatarsByPhone/);
  assert.match(repository, /listContactPhoneNumbersForAvatarSync/);
  assert.match(repository, /contact\.avatar_url IS DISTINCT FROM incoming\.avatar_url/);
  assert.match(repository, /c\.avatar_url/);
  assert.match(contacts, /const ContactAvatar/);
  assert.match(contacts, /contact\.avatarUrl/);
  assert.match(inbox, /referrerPolicy="no-referrer"/);
  assert.match(statusRoute, /contactAvatars: getWhatsappContactAvatarSyncStatus\(\)/);
  // A sessão do WhatsApp é global, mas a gravação deve usar o tenant autenticado.
  // Em produção a consulta encontrou fotos e as salvou na organização órfã do env.
  assert.match(syncRoute, /resyncWhatsappContacts\(organizationId\)/);
  // rc13 montava o tctoken fora do nó <picture> e as consultas expiravam; rc14
  // contém a correção oficial do protocolo de foto de perfil.
  assert.match(packageJson, /"@whiskeysockets\/baileys": "7\.0\.0-rc14"/);
});

test("limpeza da agenda importada preserva quem tem historico", async () => {
  const repository = await read("lib/supabase-repo.ts");
  const remove = repository.slice(
    repository.indexOf("export async function deleteImportedWhatsappContacts"),
    repository.indexOf("export async function clearWhatsappDirectory"),
  );

  // Sem o filtro de origem a limpeza apagaria clientes reais; sem o NOT EXISTS
  // apagaria contatos com conversa, levando o historico e quebrando a referencia.
  assert.match(remove, /origin = \$2/);
  assert.match(remove, /NOT EXISTS/);
  assert.match(remove, /FROM conversations/);

  // A importacao nao pode sobrescrever contato existente nem remarca-lo como
  // importado, o que o exporia a limpeza.
  const importer = repository.slice(
    repository.indexOf("export async function importWhatsappContacts"),
    repository.indexOf("export async function deleteImportedWhatsappContacts"),
  );
  assert.match(importer, /ON CONFLICT \(organization_id, phone_number\) DO NOTHING/);
});

test("imagem em mensagem temporaria ou de visualizacao unica e reconhecida", async () => {
  const client = await read("lib/whatsapp-client.ts");

  // O WhatsApp encapsula o conteudo em ephemeralMessage, viewOnceMessage e
  // documentWithCaptionMessage. Lendo message.imageMessage direto, a foto nao era
  // reconhecida como midia nem como texto e a mensagem sumia sem rastro.
  assert.match(client, /normalizeMessageContent/);
  assert.match(client, /function messageContent\(/);

  const detect = client.slice(
    client.indexOf("function detectInboundMedia"),
    client.indexOf("async function downloadInboundMedia"),
  );
  assert.match(detect, /const message = messageContent\(raw\)/);

  // Midia expirada no servidor exige pedir o reenvio; sem o contexto o download
  // falhava em definitivo.
  assert.match(client, /reuploadRequest: sock\.updateMediaMessage/);
});

test("shutdown usa a API do Baileys", async () => {
  const server = await read("server.cjs");
  assert.match(server, /__waClient\.end\(undefined\)/);
  assert.doesNotMatch(server, /__waClient\.destroy\(\)/);
});

test("somente administrador altera contas e a última conta admin é protegida", async () => {
  const [collectionRoute, itemRoute] = await Promise.all([
    read("app/api/admin/users/route.ts"),
    read("app/api/admin/users/[id]/route.ts"),
  ]);
  assert.match(collectionRoute, /"admin_users", "read"/);
  assert.match(collectionRoute, /"admin_users", "create"/);
  assert.match(itemRoute, /"admin_users", "update"/);
  assert.match(itemRoute, /"admin_users", "delete"/);
  assert.match(itemRoute, /A organizacao deve manter ao menos um administrador ativo/);
});

test("métricas gerenciais não ficam disponíveis ao atendente por API direta", async () => {
  const [route, settings] = await Promise.all([
    read("app/api/dashboard/metrics/route.ts"),
    read("lib/menu-settings.ts"),
  ]);
  assert.match(route, /requireMenuPermission\(auth\.session, "dashboard", "read"\)/);
  assert.match(settings, /dashboard: \{ read: CAN_MANAGE/);
});

test("banco serializa a proteção do último administrador por tenant", async () => {
  const migration = await read(
    "supabase/migrations/202607240007_protect_last_admin.sql",
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /last_active_admin/);
  assert.match(migration, /BEFORE UPDATE OF role, is_active OR DELETE/);
});

test("preset do supermercado só faz bootstrap quando o tenant não tem nenhuma fila, não a cada mensagem", async () => {
  const route = await read("app/api/webhooks/n8n/ticket-upsert/route.ts");
  assert.doesNotMatch(route, /isSupermarketQueuePresetApplied/);
  assert.match(route, /supermarketQueuesReady = allQueues\.length > 0/);
  assert.match(route, /activeMenuOptions: queues\.map/);

  const setup = await read("lib/supermarket-setup.ts");
  assert.doesNotMatch(setup, /isSupermarketQueuePresetApplied/);
});
