@echo off
echo ========================================
echo  TESTE DE MENSAGEM WHATSAPP - WILLTALK
echo ========================================
echo.

echo Este script simula uma mensagem WhatsApp REAL chegando no WillTalk
echo e testa TODO o fluxo: WhatsApp -> WillTalk -> n8n -> MAVO.AI -> Resposta
echo.

echo âš ï¸  PRÃ‰-REQUISITOS IMPORTANTES:
echo 1. WillTalk COM WhatsApp CONECTADO (QR code escaneado)
echo 2. MAVO.AI rodando (porta 3000)
echo 3. n8n configurado (opcional, para fluxo completo)
echo.

set /p TESTAR= "WillTalk estÃ¡ com WhatsApp conectado? (S/N): "
if /i "%TESTAR%" neq "S" (
    echo.
    echo âš ï¸  Para teste REAL, conecte o WhatsApp primeiro:
    echo 1. Acesse: http://localhost:4002
    echo 2. VÃ¡ em ConfiguraÃ§Ãµes -> WhatsApp
    echo 3. Escaneie o QR code com seu celular
    echo 4. Aguarde "Conectado"
    echo.
    set /p CONTINUAR= "Deseja continuar com teste SIMULADO? (S/N): "
    if /i "%CONTINUAR%" neq "S" (
        echo Teste cancelado.
        pause
        exit /b 0
    )
)

echo.
echo ========================================
echo  TESTE 1: MENSAGEM SIMULADA VIA API
echo ========================================
echo.

set TEST_ID=whatsapp-test-%time:~0,2%%time:~3,2%%time:~6,2%
set CLIENTE_NOME=Cliente WhatsApp Teste
set CLIENTE_TELEFONE=5511999999999

echo ðŸ“± Simulando mensagem WhatsApp de %CLIENTE_TELEFONE%
echo ðŸ“ Mensagem: "Minha impressora tÃ©rmica nÃ£o imprime cupom fiscal"
echo ðŸ†” Ticket ID: %TEST_ID%
echo.

echo Enviando para endpoint de triagem...
curl -X POST http://localhost:4002/api/webhooks/n8n/ticket-upsert ^
  -H "Authorization: Bearer %WILLTALK_WEBHOOK_TOKEN%" ^
  -H "Content-Type: application/json" ^
  -d "{^"event_id^":^"whatsapp-sim-%TEST_ID%^",^"canal^":^"whatsapp^",^"cliente^":{^"nome^":^"%CLIENTE_NOME%^",^"telefone^":^"%CLIENTE_TELEFONE%^"},^"mensagem^":^"Minha impressora tÃ©rmica nÃ£o imprime cupom fiscal, apenas faz barulho de motor. O que pode ser?^",^"ticket_id^":^"%TEST_ID%^"}" ^
  --max-time 15

echo.
echo.
echo ========================================
echo  TESTE 2: RESPOSTA DE TRIAGEM
echo ========================================
echo.

echo Aguardando 3 segundos para processamento...
timeout /t 3 /nobreak > nul

echo Testando resposta do menu de triagem...
echo Se a triagem nÃ£o estiver completa, WillTalk enviarÃ¡ menu:
echo "1 - Suporte TÃ©cnico, 2 - Financeiro, etc."
echo.
echo Verifique no console do WillTalk a resposta enviada.
echo.

echo ========================================
echo  TESTE 3: SIMULAR RESPOSTA DO CLIENTE
echo ========================================
echo.

echo Simulando cliente respondendo "1" ao menu...
curl -X POST http://localhost:4002/api/webhooks/n8n/ticket-upsert ^
  -H "Authorization: Bearer %WILLTALK_WEBHOOK_TOKEN%" ^
  -H "Content-Type: application/json" ^
  -d "{^"event_id^":^"whatsapp-resp-%TEST_ID%^",^"canal^":^"whatsapp^",^"cliente^":{^"nome^":^"%CLIENTE_NOME%^",^"telefone^":^"%CLIENTE_TELEFONE%^"},^"mensagem^":^"1^",^"ticket_id^":^"%TEST_ID%^"}" ^
  --max-time 15

echo.
echo.
echo ========================================
echo  TESTE 4: VERIFICAR INTEGRAÃ‡ÃƒO MAVO.AI
echo ========================================
echo.

echo Aguardando 5 segundos para processamento MAVO.AI...
timeout /t 5 /nobreak > nul

echo Verificando se MAVO.AI recebeu a ingestÃ£o...
curl -s http://localhost:3000/api/health > nul
if %errorlevel% equ 0 (
    echo âœ… MAVO.AI estÃ¡ respondendo
    echo.
    echo Verificando Ãºltimo atendimento no banco...
    psql -U postgres -d mavoai -c "SELECT cliente, LEFT(texto_original, 50) as problema, created_at FROM atendimentos ORDER BY created_at DESC LIMIT 1;" 2>nul
) else (
    echo âš ï¸  MAVO.AI nÃ£o estÃ¡ respondendo
)

echo.
echo ========================================
echo  TESTE 5: VERIFICAR WILLTALK
echo ========================================
echo.

echo Verificando conversa no WillTalk...
psql -U postgres -d willtalk -c "SELECT c.id, c.status, c.triageCompleted, c.menuAttempts, COUNT(m.id) as mensagens FROM conversations c LEFT JOIN messages m ON c.id = m.conversationId WHERE c.contactPhone LIKE '%%5511999999999%%' GROUP BY c.id ORDER BY c.created_at DESC LIMIT 1;" 2>nul

echo.
echo ========================================
echo  ðŸŽ¯ O QUE VERIFICAR AGORA:
echo ========================================
echo.
echo 1. CONSOLE WILLTALK (terminal npm run dev):
echo    - Deve mostrar: "n8n ticket-upsert processed"
echo    - Deve mostrar: "Triage reply sent via WhatsApp"
echo    - Se triagem completa: "Cerebro ingestao fire-and-forget"
echo.
echo 2. CONSOLE MAVO.AI (terminal npm run dev):
echo    - Deve mostrar: "âœ… Atendimento ingerido"
echo    - Deve mostrar processamento IA assÃ­ncrono
echo.
echo 3. INTERFACE WILLTALK: http://localhost:4002
echo    - Conversas -> Deve aparecer "Cliente WhatsApp Teste"
echo    - Clique na conversa para ver mensagens
echo.
echo 4. INTERFACE MAVO.AI: http://localhost:3000
echo    - Dashboard -> Deve mostrar atendimento recente
echo    - Busca -> Procure por "impressora tÃ©rmica"
echo.
echo 5. SE N8N ESTIVER RODANDO: http://localhost:5678
echo    - Workflows -> ExecuÃ§Ãµes recentes
echo    - Verifique se webhook foi processado
echo.
echo ========================================
echo  ðŸ› TROUBLESHOOTING:
echo ========================================
echo.
echo PROBLEMA: WillTalk nÃ£o processa mensagem
echo SOLUÃ‡ÃƒO: Verifique .env:
echo   WILLTALK_WEBHOOK_TOKEN=%WILLTALK_WEBHOOK_TOKEN%
echo   WILLTALK_N8N_ONLY=false
echo.
echo PROBLEMA: MAVO.AI nÃ£o recebe ingestÃ£o
echo SOLUÃ‡ÃƒO: Teste endpoint diretamente:
echo   curl -X POST http://localhost:3000/api/ingestao/willtalk ^
echo     -H "Authorization: Bearer %WILLTALK_WEBHOOK_TOKEN%" ^
echo     -H "Content-Type: application/json" ^
echo     -d "{\"ticket_id\":\"TEST\",\"cliente\":\"Teste\",\"mensagens\":\"Teste\"}"
echo.
echo PROBLEMA: NÃ£o hÃ¡ resposta automÃ¡tica
echo SOLUÃ‡ÃƒO: Verifique se triagem completou (triageCompleted: true)
echo   E se WILLTALK_AUTO_REPLY_ENABLED=true no .env
echo.
echo ========================================
echo  ðŸ“ž TESTE COM WHATSAPP REAL:
echo ========================================
echo.
echo Para teste REAL com WhatsApp:
echo 1. Conecte seu WhatsApp no WillTalk (QR code)
echo 2. Envie mensagem do seu celular para o nÃºmero do WillTalk
echo 3. Observe o fluxo completo:
echo    - WillTalk recebe mensagem
echo    - Envia para n8n (se configurado)
echo    - Processa triagem
echo    - Se triagem completa, envia para MAVO.AI
echo    - MAVO.AI gera resposta IA
echo    - Resposta volta para seu WhatsApp
echo.
echo ========================================
echo  âœ… TESTE COMPLETO DO SISTEMA!
echo ========================================
echo.
pause