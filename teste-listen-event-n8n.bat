@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Uso:
REM   teste-listen-event-n8n.bat
REM   teste-listen-event-n8n.bat "http://localhost:5678/webhook-test/SEU-ID"

set "URL=%~1"
if "%URL%"=="" set "URL=http://localhost:5678/webhook-test/willtalk-ingestao"

set "EVENT_ID=bat-test-%RANDOM%%RANDOM%"
set "JSON={\"event_id\":\"%EVENT_ID%\",\"canal\":\"whatsapp\",\"organization_id\":\"org_willtalk-40733\",\"cliente\":{\"nome\":\"Teste BAT\",\"telefone\":\"+5511999999999\"},\"mensagem\":\"teste listen for test event via bat\"}"

echo ========================================
echo  Teste rapido - n8n Listen for test event
echo ========================================
echo URL: %URL%
echo EVENT_ID: %EVENT_ID%
echo.
echo Enviando requisicao...
echo.

curl -i -X POST "%URL%" ^
  -H "Content-Type: application/json" ^
  --data "%JSON%"

echo.
echo ----------------------------------------
echo Se retornar 200/2xx, chegou no webhook de teste.
echo Se retornar 404, clique em "Listen for test event" no n8n e rode novamente.
echo ----------------------------------------
echo.
pause

