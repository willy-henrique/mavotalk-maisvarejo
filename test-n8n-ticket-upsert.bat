@echo off
chcp 65001 >nul 2>&1
title WillTalk - Teste ticket-upsert
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"
set "TOKEN="
set "DEFAULT_PHONE=5511999997777"
set "DEFAULT_NAME=Cliente Teste"
set "WILLTALK_PORT=4002"
set "UPSERT_URL=http://localhost:%WILLTALK_PORT%/api/webhooks/n8n/ticket-upsert"
set "N8N_URL="
set "MODE=1"
set "TARGET_URL="
set "SEND_URL="

echo.
echo  ==============================================
echo   WillTalk - Teste ticket-upsert (local)
echo  ==============================================
echo.

for /f "usebackq delims=" %%T in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\read-willtalk-webhook-token.ps1" "%CD%"`) do set "TOKEN=%%T"
for /f "usebackq delims=" %%U in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\read-willtalk-webhook-token.ps1" "%CD%" "WILLTALK_WEBHOOK_URL"`) do set "N8N_URL=%%U"

if "!TOKEN!"=="" (
  echo  ERRO: Nao foi possivel ler WILLTALK_WEBHOOK_TOKEN do .env.
  echo  Confira se existe .env nesta pasta: %CD%
  echo.
  goto :end_error
)

echo  Token carregado do .env.
echo.
if "!N8N_URL!"=="" (
  set "N8N_URL=http://127.0.0.1:5678/webhook/willtalk-ingestao"
)

echo  Escolha o alvo do teste:
echo    [1] WillTalk direto (ticket-upsert local)
echo    [2] Fluxo n8n (webhook de ingestao) [sem WhatsApp]
echo.
set /p "MODE=  Modo [1]: "
if "!MODE!"=="" set "MODE=1"

if /i "!MODE!"=="2" (
  set "TARGET_URL=!N8N_URL!"
) else (
  set "TARGET_URL=!UPSERT_URL!"
)
set "SEND_URL=!TARGET_URL!"

echo  URL alvo: !TARGET_URL!
echo.

echo  [1/3] Verificando endpoint alvo...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test-upsert-check.ps1" "!TARGET_URL!" "%TOKEN%"
set "CHECK_EXIT=%ERRORLEVEL%"
if not "!CHECK_EXIT!"=="0" (
  echo.
  echo  ERRO: Endpoint alvo nao esta respondendo.
  echo  Codigo de saida do check: !CHECK_EXIT!
  echo.
  echo  Verifique os servicos necessarios:
  echo    - WillTalk: npm run dev
  echo    - n8n: workflow ativo e URL correta no .env (WILLTALK_WEBHOOK_URL)
  if /i "!MODE!"=="2" (
  echo    - no n8n, confirme o path do webhook e se o workflow esta Active
  echo    - teste rapido: powershell -ExecutionPolicy Bypass -File "scripts\verify-n8n-webhook.ps1"
  )
  echo.
  echo  Rode este .bat novamente apos subir os servicos.
  echo.
  goto :end_error
)
echo        OK - Endpoint respondendo.
echo.

if /i "!MODE!"=="2" (
  set "WEBHOOK_TEST_URL=!TARGET_URL:/webhook/=/webhook-test/!"
  if /i not "!WEBHOOK_TEST_URL!"=="!TARGET_URL!" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=@{Authorization='Bearer %TOKEN%';'Content-Type'='application/json'}; $b='{\"probe\":\"direct\"}'; try { Invoke-WebRequest -Uri '%TARGET_URL%' -Method POST -Headers $h -Body $b -UseBasicParsing -TimeoutSec 6 | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }" >nul 2>&1
    if not "!ERRORLEVEL!"=="0" (
      powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=@{Authorization='Bearer %TOKEN%';'Content-Type'='application/json'}; $b='{\"probe\":\"fallback\"}'; try { Invoke-WebRequest -Uri '%WEBHOOK_TEST_URL%' -Method POST -Headers $h -Body $b -UseBasicParsing -TimeoutSec 6 | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }" >nul 2>&1
      if "!ERRORLEVEL!"=="0" (
        set "SEND_URL=!WEBHOOK_TEST_URL!"
        echo  Aviso: usando endpoint de teste do n8n para envio.
        echo         !SEND_URL!
        echo.
      )
    )
  )
)

echo  [2/3] Dados do teste:
echo.
echo   AVISO: O telefone identifica a CONVERSA no banco.
echo   Com triagem ja concluida, o bot pode enviar confirmacao curta (pos-triagem).
echo   Para ver o menu de novo: outro telefone (ex: 5511888077777) ou reinicie triagem no painel.
echo.

set /p "MSG=  Mensagem de teste: "
if "!MSG!"=="" (
  echo   [ERRO] Mensagem nao pode ser vazia.
  goto :end_error
)

set /p "PHONE_INPUT=  Telefone [%DEFAULT_PHONE%]: "
if "!PHONE_INPUT!"=="" (set "PHONE=%DEFAULT_PHONE%") else (set "PHONE=!PHONE_INPUT!")

set /p "NAME_INPUT=  Nome do cliente [%DEFAULT_NAME%]: "
if "!NAME_INPUT!"=="" (set "CNAME=%DEFAULT_NAME%") else (set "CNAME=!NAME_INPUT!")

for /f %%i in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyyMMddHHmmssfff')"') do set "TS=%%i"
set "EVENT_ID=evt-bat-!TS!"

echo.
echo  [3/3] Enviando POST para ticket-upsert...
echo         event_id: !EVENT_ID!
echo         telefone: !PHONE!
echo         nome:     !CNAME!
echo         mensagem: !MSG!
if /i "!MODE!"=="2" (
echo         fluxo:    n8n webhook
) else (
echo         fluxo:    ticket-upsert direto
)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test-upsert-send.ps1" "!SEND_URL!" "%TOKEN%" "!EVENT_ID!" "!PHONE!" "!CNAME!" "!MSG!" "!MODE!"

echo.
echo  Teste finalizado.
echo.
goto :end_ok

:end_error
echo.
echo  Pressione qualquer tecla para fechar...
pause >nul
exit /b 1

:end_ok
echo  Pressione qualquer tecla para fechar...
pause >nul
exit /b 0
