@echo off
chcp 65001 > nul

rem === Token lido do ambiente ou do .env (NUNCA hardcoded) ===
if "%WILLTALK_WEBHOOK_TOKEN%"=="" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do if "%%A"=="WILLTALK_WEBHOOK_TOKEN" set "WILLTALK_WEBHOOK_TOKEN=%%B"
)
if "%WILLTALK_WEBHOOK_TOKEN%"=="" (
  echo [ERRO] Defina WILLTALK_WEBHOOK_TOKEN no ambiente ou no .env antes de rodar este teste.
  pause
  exit /b 1
)
echo ========================================
echo  TESTE DE INTEGRACAO COMPLETA - WILLTALK
echo ========================================
echo.

echo Este script testa TODA a integracao WillTalk + n8n + MAVO.AI
echo.
echo PRE-REQUISITOS:
echo 1. WillTalk rodando (npm run dev)
echo 2. MAVO.AI rodando (npm run dev na pasta chat-inteligente)
echo 3. n8n rodando (opcional, porta 5678)
echo 4. PostgreSQL rodando (portas 5432 e 5433)
echo.

echo PASSO 1: Verificar servicos...
echo.
curl -s http://localhost:4002/api/health > nul
if %errorlevel% neq 0 (
    echo [ERRO] WillTalk nao esta respondendo na porta 4002
    echo Execute: npm run dev
    pause
    exit /b 1
) else (
    echo [OK] WillTalk OK (porta 4002)
)

curl -s http://localhost:3000/api/health > nul
if %errorlevel% neq 0 (
    echo [AVISO] MAVO.AI nao esta respondendo na porta 3000
    echo Execute na pasta chat-inteligente: npm run dev
) else (
    echo [OK] MAVO.AI OK (porta 3000)
)

curl -s http://localhost:5678/healthz > nul
if %errorlevel% neq 0 (
    echo [AVISO] n8n nao esta respondendo na porta 5678
    echo Para testar completo: docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n
) else (
    echo [OK] n8n OK (porta 5678)
)

echo.
echo PASSO 2: Testar endpoint de triagem WillTalk...
echo.
set TEST_EVENT_ID=test-willtalk-%date:~-4,4%%date:~-7,2%%date:~-10,2%-%time:~0,2%%time:~3,2%
set TEST_TICKET_ID=WT-TEST-%date:~-4,4%%date:~-7,2%%date:~-10,2%

echo Enviando para: POST http://localhost:4002/api/webhooks/n8n/ticket-upsert
echo Event ID: %TEST_EVENT_ID%
echo Ticket ID: %TEST_TICKET_ID%
echo.

rem Criar arquivo JSON temporario para evitar problemas com acentuacao
echo {"event_id":"%TEST_EVENT_ID%","canal":"whatsapp","cliente":{"nome":"Cliente Teste WillTalk","telefone":"5511999999999"},"mensagem":"Impressora termica nao imprime cupom fiscal. Teste de integracao completa.","ticket_id":"%TEST_TICKET_ID%"} > test_payload.json

curl -X POST http://localhost:4002/api/webhooks/n8n/ticket-upsert ^
  -H "Authorization: Bearer %WILLTALK_WEBHOOK_TOKEN%" ^
  -H "Content-Type: application/json" ^
  --data-binary "@test_payload.json"

del test_payload.json > nul 2>&1

echo.
echo.
echo PASSO 3: Testar ingestao direta MAVO.AI...
echo.
rem Criar arquivo JSON para MAVO.AI
echo {"ticket_id":"%TEST_TICKET_ID%-DIRETO","cliente":"Cliente Teste Direto","mensagens":"Sistema lento para emitir NFC-e, timeout apos 30 segundos","canal":"whatsapp","tecnico":"willtalk","data_evento":"%date:~-4,4%-%date:~-7,2%-%date:~-10,2%T%time:~0,2%:%time:~3,2%:%time:~6,2%Z","cliente_telefone":"5511999999999"} > test_mavoai.json

curl -X POST http://localhost:3000/api/ingestao/willtalk ^
  -H "Authorization: Bearer %WILLTALK_WEBHOOK_TOKEN%" ^
  -H "Content-Type: application/json" ^
  --data-binary "@test_mavoai.json"

del test_mavoai.json > nul 2>&1

echo.
echo.
echo PASSO 4: Testar resposta assistida MAVO.AI...
echo.
rem Criar arquivo JSON para resposta IA
echo {"texto":"Impressora termica nao imprime cupom fiscal, apenas faz barulho de motor. O que pode ser?","ticket_id":"%TEST_TICKET_ID%","cliente":"Cliente Teste"} > test_resposta.json

curl -X POST http://localhost:3000/api/resposta-assistida ^
  -H "Authorization: Bearer %WILLTALK_WEBHOOK_TOKEN%" ^
  -H "Content-Type: application/json" ^
  --data-binary "@test_resposta.json"

del test_resposta.json > nul 2>&1

echo.
echo.
echo PASSO 5: Testar webhook n8n (se estiver rodando)...
echo.
rem Criar arquivo JSON para n8n
echo {"ticket_id":"%TEST_TICKET_ID%-N8N","cliente":"Cliente Teste n8n","mensagem":"Balanca Toledo nao conecta ao sistema, erro dispositivo nao encontrado","cliente_telefone":"5511999999999","canal":"whatsapp","timestamp":"%date:~-4,4%-%date:~-7,2%-%date:~-10,2%T%time:~0,2%:%time:~3,2%:%time:~6,2%Z"} > test_n8n.json

curl -X POST http://localhost:5678/webhook-test/03651a89-8f3b-4635-a06d-e97157750352 ^
  -H "Content-Type: application/json" ^
  --data-binary "@test_n8n.json"

del test_n8n.json > nul 2>&1

echo.
echo.
echo PASSO 6: Verificar bancos de dados...
echo.
echo MAVO.AI PostgreSQL (porta 5432):
psql -U postgres -d mavoai -c "SELECT COUNT(*) as total_atendimentos, MAX(created_at) as ultimo FROM atendimentos;" 2>nul
if %errorlevel% neq 0 (
    echo [AVISO] Nao consegui conectar ao PostgreSQL MAVO.AI (porta 5432)
)

echo.
echo WillTalk PostgreSQL (porta 5433):
psql -U postgres -d willtalk -c "SELECT COUNT(*) as total_conversations, MAX(created_at) as ultimo FROM conversations;" 2>nul
if %errorlevel% neq 0 (
    echo [AVISO] Nao consegui conectar ao PostgreSQL WillTalk (porta 5433)
)

echo.
echo ========================================
echo  RESUMO DO TESTE
echo ========================================
echo.
echo [OK] Testes executados:
echo 1. Endpoint triagem WillTalk: /api/webhooks/n8n/ticket-upsert
echo 2. Ingestao MAVO.AI: /api/ingestao/willtalk
echo 3. Resposta IA MAVO.AI: /api/resposta-assistida
echo 4. Webhook n8n: /webhook-test/03651a89-8f3b-4635-a06d-e97157750352
echo 5. Bancos de dados: PostgreSQL (5432, 5433)
echo.
echo O QUE VERIFICAR:
echo.
echo 1. Console WillTalk: Deve mostrar logs de processamento
echo 2. Console MAVO.AI: Deve mostrar ingestao e processamento IA
echo 3. Interface WillTalk: http://localhost:4002
echo    - Verificar se conversa de teste aparece
echo 4. Interface MAVO.AI: http://localhost:3000
echo    - Verificar se atendimento foi criado
echo 5. n8n: http://localhost:5678 (se rodando)
echo    - Verificar execucoes do workflow
echo.
echo SE ALGO FALHOU:
echo.
echo 1. Verifique tokens no .env:
echo    WILLTALK_WEBHOOK_TOKEN=%WILLTALK_WEBHOOK_TOKEN%
echo.
echo 2. Verifique URLs:
echo    WILLTALK_WEBHOOK_URL=http://localhost:5678/webhook-test/03651a89-8f3b-4635-a06d-e97157750352
echo    MAVOAI_BASE_URL=http://localhost:3000
echo.
echo 3. Execute o script de atualizacao:
echo    cd C:\willydev\chat-inteligente
echo    scripts\atualizar-willtalk-env.bat
echo.
echo 4. Reinicie os servicos:
echo    WillTalk: npm run dev
echo    MAVO.AI: cd C:\willydev\chat-inteligente && npm run dev
echo.
echo ========================================
echo  TESTE COMPLETO - SISTEMA INTEGRADO!
echo ========================================
echo.
echo Proximos passos:
echo 1. Envie uma mensagem real pelo WhatsApp
echo 2. Monitore o fluxo completo
echo 3. Verifique resposta automatica da IA
echo.
pause