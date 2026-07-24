@echo off
echo ========================================
echo  CORREÇÃO WILLTALK - WhatsApp não chega em Aguardando
echo ========================================
echo.

echo 1. VERIFICANDO POSTGRESQL...
echo ----------------------------------------
netstat -an | find ":5433" > nul
if %errorlevel% equ 0 (
    echo ✅ PostgreSQL rodando na porta 5433
) else (
    echo ❌ PostgreSQL NÃO está rodando na porta 5433
    echo    Inicie o PostgreSQL na porta 5433
    echo    OU altere DATABASE_URL no .env
)

echo.
echo 2. VERIFICANDO CONFIGURAÇÃO .env...
echo ----------------------------------------
echo WILLTALK_N8N_ONLY está configurado como: true
echo.
echo ⚠️  COM WILLTALK_N8N_ONLY=true:
echo    - Mensagens vão para handleInboundViaBotTriagem
echo    - Chama invokeTicketUpsertLocal
echo    - Depende do endpoint /api/webhooks/n8n/ticket-upsert
echo    - Se n8n não estiver configurado, pode não processar
echo.
set /p ALTERAR_N8N_ONLY= "Deseja alterar WILLTALK_N8N_ONLY para false? (S/N): "
if /i "%ALTERAR_N8N_ONLY%"=="S" (
    echo Alterando WILLTALK_N8N_ONLY para false...
    powershell -Command "(Get-Content .env) -replace 'WILLTALK_N8N_ONLY=true', 'WILLTALK_N8N_ONLY=false' | Set-Content .env"
    echo ✅ WILLTALK_N8N_ONLY alterado para false
)

echo.
echo 3. INICIANDO WILLTALK...
echo ----------------------------------------
echo Execute em um NOVO terminal:
echo   cd C:\willydev\willtalk
echo   npm run dev
echo.
echo Aguarde até ver: "> Ready on http://0.0.0.0:4002"
echo.

echo 4. CONECTAR WHATSAPP...
echo ----------------------------------------
echo Após WillTalk iniciar:
echo 1. Acesse: http://localhost:4002
echo 2. Login: admin@willtalk.com / admin123
echo 3. Vá em Configurações -> WhatsApp
echo 4. Escaneie QR code com seu celular
echo 5. Aguarde "Conectado"
echo.

echo 5. TESTAR SISTEMA...
echo ----------------------------------------
echo Após WhatsApp conectado:
echo 1. Envie mensagem do seu celular
echo 2. Verifique no WillTalk:
echo    - Conversas -> Deve aparecer na fila "Aguardando"
echo    - Status deve ser "aguardando"
echo.
echo OU execute teste automatizado:
echo   teste-rapido-windows.bat
echo.

echo 6. SE PROBLEMA PERSISTIR...
echo ----------------------------------------
echo 1. Verifique logs do WillTalk (terminal npm run dev)
echo 2. Procure por erros como:
echo    - "Failed to process inbound WhatsApp message"
echo    - "PostgreSQL connection error"
echo    - "WhatsApp client ainda nao esta pronto"
echo.
echo 3. Verifique se há filas configuradas:
echo    - WillTalk -> Filas -> Deve ter pelo menos uma fila ativa
echo    - Cada fila precisa de menuOption (1, 2, 3...)
echo.

echo ========================================
echo  FLUXO CORRETO ESPERADO:
echo ========================================
echo WhatsApp -> WillTalk -> Cria conversa "aguardando" -> Envia menu triagem
echo Cliente responde número -> WillTalk processa -> Atualiza fila
echo Se triagem completa -> Envia para MAVO.AI (se configurado)
echo.

pause