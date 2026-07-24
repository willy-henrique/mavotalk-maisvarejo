@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ==========================================================
REM Teste completo IA-first (simula mensagem + resposta IA)
REM Uso:
REM   teste-fluxo-completo-ia.bat
REM   teste-fluxo-completo-ia.bat "http://127.0.0.1:4002/api/webhooks/n8n/ticket-upsert"
REM ==========================================================

set "URL=%~1"
if "%URL%"=="" set "URL=http://127.0.0.1:4002/api/webhooks/n8n/ticket-upsert"

if not exist ".env" (
  echo [ERRO] Arquivo .env nao encontrado na pasta atual.
  echo Execute este .bat dentro de C:\willydev\willtalk
  pause
  exit /b 1
)

set "TOKEN="
set "ORG_ID="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /I "WILLTALK_WEBHOOK_TOKEN=" ".env"`) do set "TOKEN=%%B"
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /I "DEFAULT_ORG_ID=" ".env"`) do set "ORG_ID=%%B"

if "%TOKEN%"=="" (
  echo [ERRO] WILLTALK_WEBHOOK_TOKEN nao encontrado no .env
  pause
  exit /b 1
)
if "%ORG_ID%"=="" set "ORG_ID=org_willtalk_default"

set "CLIENTE_NOME=Teste IA"
set "CLIENTE_FONE=+5511999999999"
set "MSG_CLIENTE=Meu sistema fiscal parou e nao emite nota."
set "MSG_IA=Entendi seu caso. Ja classifiquei e encaminhei para o time Fiscal com prioridade alta. Vamos retornar por aqui em breve."
set "QUEUE_ID="

echo ========================================
echo  TESTE COMPLETO - WILLTALK IA-FIRST
echo ========================================
echo URL..............: %URL%
echo ORG..............: %ORG_ID%
echo.

set /p CLIENTE_NOME=Nome do cliente [Teste IA]:
if "!CLIENTE_NOME!"=="" set "CLIENTE_NOME=Teste IA"

set /p CLIENTE_FONE=Telefone WhatsApp [+5511999999999]:
if "!CLIENTE_FONE!"=="" set "CLIENTE_FONE=+5511999999999"

set /p MSG_CLIENTE=Mensagem inbound [Meu sistema fiscal parou e nao emite nota.]:
if "!MSG_CLIENTE!"=="" set "MSG_CLIENTE=Meu sistema fiscal parou e nao emite nota."

set /p MSG_IA=Resposta da IA [Entendi seu caso. Ja classifiquei e encaminhei para o time Fiscal com prioridade alta. Vamos retornar por aqui em breve.]:
if "!MSG_IA!"=="" set "MSG_IA=Entendi seu caso. Ja classifiquei e encaminhei para o time Fiscal com prioridade alta. Vamos retornar por aqui em breve."

set /p QUEUE_ID=Queue ID (opcional, Enter para vazio):

echo.
echo Enviando payload completo...
echo.

set "URL_PS=%URL%"
set "TOKEN_PS=%TOKEN%"
set "ORG_ID_PS=%ORG_ID%"
set "CLIENTE_NOME_PS=%CLIENTE_NOME%"
set "CLIENTE_FONE_PS=%CLIENTE_FONE%"
set "MSG_CLIENTE_PS=%MSG_CLIENTE%"
set "MSG_IA_PS=%MSG_IA%"
set "QUEUE_ID_PS=%QUEUE_ID%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$eventId = 'bat-full-' + [Guid]::NewGuid().ToString('N');" ^
  "$body = @{" ^
  "  event_id = $eventId;" ^
  "  canal = 'whatsapp';" ^
  "  organization_id = $env:ORG_ID_PS;" ^
  "  cliente = @{ nome = $env:CLIENTE_NOME_PS; telefone = $env:CLIENTE_FONE_PS };" ^
  "  mensagem = $env:MSG_CLIENTE_PS;" ^
  "  metadata = @{" ^
  "    ingest_origin = 'whatsapp-unofficial';" ^
  "    triage_completed = $true;" ^
  "    reply_text = $env:MSG_IA_PS;" ^
  "    prioridade = 'alta';" ^
  "    severidade = 'S2'" ^
  "  }" ^
  "};" ^
  "if ($env:QUEUE_ID_PS -and $env:QUEUE_ID_PS.Trim() -ne '') { $body.queue_id = $env:QUEUE_ID_PS.Trim() };" ^
  "$json = $body | ConvertTo-Json -Depth 8;" ^
  "try {" ^
  "  $res = Invoke-WebRequest -Uri $env:URL_PS -Method POST -Headers @{ Authorization = ('Bearer ' + $env:TOKEN_PS); 'Content-Type' = 'application/json' } -Body $json -UseBasicParsing -TimeoutSec 25;" ^
  "  Write-Host ('HTTP: ' + [int]$res.StatusCode) -ForegroundColor Green;" ^
  "  Write-Host 'Resposta:' -ForegroundColor Cyan;" ^
  "  Write-Output $res.Content;" ^
  "} catch {" ^
  "  Write-Host 'Falha no teste.' -ForegroundColor Red;" ^
  "  if ($_.Exception.Response -ne $null) {" ^
  "    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream());" ^
  "    $reader.BaseStream.Position = 0; $reader.DiscardBufferedData();" ^
  "    $resp = $reader.ReadToEnd();" ^
  "    Write-Host $resp;" ^
  "  } else {" ^
  "    Write-Host $_.Exception.Message;" ^
  "  }" ^
  "  exit 1;" ^
  "}"

echo.
echo ----------------------------------------
echo Esperado no sucesso:
echo - HTTP 200
echo - action updated/created
echo - shouldReply true
echo - triageCompleted true
echo ----------------------------------------
echo.
pause

