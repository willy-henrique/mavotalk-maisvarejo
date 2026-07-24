@echo off
chcp 65001 >nul 2>&1
echo Verificando se o webhook n8n esta registrado (mesmo path que WILLTALK_WEBHOOK_URL)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\verify-n8n-webhook.ps1"
echo.
pause
