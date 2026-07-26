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
echo  TESTE RAPIDO WILLTALK + MAVO.AI - WINDOWS
echo ========================================
echo.

echo [INFO] Usando arquivos JSON temporarios para evitar problemas de acentuacao
echo.

echo PASSO 1: Testar servicos basicos...
echo.
echo Testando WillTalk (porta 4002)...
curl -s http://localhost:4002/api/health
echo.
echo Testando MAVO.AI (porta 3000)...
curl -s http://localhost:3000/api/health
echo.

echo PASSO 2: Testar triagem WillTalk (SEM acentos)...
echo.
set TEST_ID=test%time:~0,2%%time:~3,2%
echo Criando payload JSON...
echo {"event_id":"test-%TEST_ID%","canal":"whatsapp","cliente":{"nome":"Cliente Teste","telefone":"5511999999999"},"mensagem":"Impressora nao imprime","ticket_id":"WT-%TEST_ID%"} > test1.json

echo Enviando para WillTalk triagem...
curl -X POST http://localhost:4002/api/webhooks/n8n/ticket-upsert ^
  -H "Authorization: Bearer %WILLTALK_WEBHOOK_TOKEN%" ^
  -H "Content-Type: application/json" ^
  --data-binary "@test1.json"

del test1.json
echo.

echo PASSO 3: Testar MAVO.AI ingestao (SEM acentos)...
echo.
echo Criando payload para MAVO.AI...
echo {"ticket_id":"MAVO-%TEST_ID%","cliente":"Cliente MAVO","mensagens":"Sistema lento para emitir NFCe","canal":"whatsapp","tecnico":"teste","data_evento":"2026-04-06T10:00:00Z","cliente_telefone":"5511999999999"} > test2.json

echo Enviando para MAVO.AI...
curl -X POST http://localhost:3000/api/ingestao/willtalk ^
  -H "Authorization: Bearer %WILLTALK_WEBHOOK_TOKEN%" ^
  -H "Content-Type: application/json" ^
  --data-binary "@test2.json"

del test2.json
echo.

echo PASSO 4: Verificar n8n (se estiver rodando)...
echo.
echo Testando n8n health...
curl -s http://localhost:5678/healthz
echo.

echo Se n8n responder, verifique:
echo 1. Workflow esta ATIVO? (toggle no canto superior direito)
echo 2. Webhook path: mavoai-ingest
echo 3. Variaveis configuradas: MAVOAI_URL, WILLTALK_URL, tokens
echo.

echo PASSO 5: Teste manual do n8n (se quiser)...
echo.
set /p TESTAR_N8N= "Deseja testar n8n webhook? (S/N): "
if /i "%TESTAR_N8N%"=="S" (
    echo Criando payload para n8n...
    echo {"ticket_id":"N8N-%TEST_ID%","cliente":"Cliente n8n","mensagem":"Teste webhook n8n","cliente_telefone":"5511999999999","canal":"whatsapp"} > test3.json
    
    echo Enviando para n8n...
    curl -X POST http://localhost:5678/webhook-test/03651a89-8f3b-4635-a06d-e97157750352 ^
      -H "Content-Type: application/json" ^
      --data-binary "@test3.json"
    
    del test3.json
    echo.
    echo Se deu erro 404: Ative o workflow no n8n!
)

echo.
echo ========================================
echo  RESULTADOS ESPERADOS
echo ========================================
echo.
echo CONSOLE WILLTALK deve mostrar:
echo - "n8n ticket-upsert processed"
echo - Se triagem completa: "Cerebro ingestao fire-and-forget"
echo.
echo CONSOLE MAVO.AI deve mostrar:
echo - "Atendimento ingerido"
echo - Processamento IA (assincrono)
echo.
echo INTERFACES:
echo - WillTalk: http://localhost:4002 (ver conversas)
echo - MAVO.AI: http://localhost:3000 (ver dashboard)
echo - n8n: http://localhost:5678 (se rodando)
echo.
echo ========================================
echo  PROBLEMAS COMUNS E SOLUCOES
echo ========================================
echo.
echo PROBLEMA: WillTalk da erro "payload_invalido"
echo SOLUCAO: Token incorreto ou schema errado
echo Teste token: %WILLTALK_WEBHOOK_TOKEN%
echo.
echo PROBLEMA: n8n da erro 404 "webhook not registered"
echo SOLUCAO: Ative o workflow! No n8n, clique no toggle (canto superior direito)
echo.
echo PROBLEMA: MAVO.AI nao responde
echo SOLUCAO: Verifique se esta rodando (npm run dev)
echo Teste: curl http://localhost:3000/api/health
echo.
echo PROBLEMA: Acentuacao quebra curl
echo SOLUCAO: Este script ja usa arquivos JSON (corrigido)
echo.
echo ========================================
echo  TESTE CONCLUIDO
echo ========================================
echo.
echo Proximos passos:
echo 1. Ative o workflow no n8n (se estiver usando)
echo 2. Envie mensagem real do WhatsApp
echo 3. Monitore o fluxo completo
echo.
pause